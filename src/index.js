/**
 * AniDoa — src/index.js
 * Cloudflare Worker الرئيسي: التوجيه، YouTube Data API، التخزين في KV، الترجمة.
 *
 * البنية:
 *   KV: series:index            → فهرس المسلسلات [{playlistId,title,thumbnail,episodeCount,addedAt}]
 *   KV: playlist:{playlistId}   → تفاصيل المسلسل {playlistId,title,episodes:[...],fetchedAt}
 *   KV: sub:{videoId}           → الترجمة العربية الجاهزة {videoId,source,translatedAt,subtitles}
 *
 * المتغيرات المطلوبة (Secrets من Dashboard):
 *   YOUTUBE_API_KEY, GEMINI_API_KEY, ADMIN_SECRET, SUPADATA_API_KEY (اختياري)
 * الربط المطلوب:
 *   ANIDOA_KV (KVNamespace)
 */

import { getEnglishSubtitles, parseSRT, parseVTT, NoSubtitlesError } from "./subtitles.js";
import { translateSubtitles } from "./translator.js";
import { renderHome, renderWatchPage, renderErrorPage } from "./ui.js";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const MAX_MANUAL_TEXT_BYTES = 500 * 1024;
const MAX_MANUAL_REQUEST_BYTES = MAX_MANUAL_TEXT_BYTES + 16 * 1024;

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      ...securityHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(message, status, extra) {
  const body = { error: message || "حدث خطأ غير متوقع" };
  if (extra) Object.assign(body, extra);
  return jsonResponse(body, status || 500);
}

function htmlResponse(html, status) {
  return new Response(html, {
    status: status || 200,
    headers: {
      ...securityHeaders(),
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * مقارنة سلاسل مقاومة لتسريب التوقيت (تقريبية ومناسبة لـ Workers).
 */
function safeSecretCompare(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function requireAdmin(request, env, bodySecret) {
  const configured = env && env.ADMIN_SECRET;
  if (!configured) {
    return { ok: false, error: "لم يتم ضبط كلمة سر المدير (ADMIN_SECRET) في إعدادات Worker بعد." };
  }
  const headerSecret = request.headers.get("x-admin-secret");
  const provided = bodySecret || headerSecret || "";
  if (!safeSecretCompare(provided, configured)) {
    return { ok: false, error: "كلمة سر المدير غير صحيحة." };
  }
  return { ok: true };
}

/**
 * استخراج playlistId من رابط كامل أو معرّف خام.
 */
export function extractPlaylistId(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const listMatch = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (listMatch) return listMatch[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed) && !trimmed.includes("://") && !trimmed.includes(" ")) {
    return trimmed;
  }
  return null;
}

function isValidVideoId(videoId) {
  return typeof videoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(videoId);
}

function isValidPlaylistId(playlistId) {
  return typeof playlistId === "string" && /^[A-Za-z0-9_-]{10,128}$/.test(playlistId);
}

async function checkTranslationRateLimit(request, env, routeKey) {
  // Local development may not have the Cloudflare Rate Limiting binding.
  if (!env || !env.ANIDOA_TRANSLATE_LIMITER) return null;

  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  try {
    const result = await env.ANIDOA_TRANSLATE_LIMITER.limit({
      key: routeKey + ":" + clientIp,
    });
    if (!result.success) {
      return errorResponse(
        "وصلت إلى الحد المؤقت لطلبات الترجمة. انتظر دقيقة ثم حاول مرة أخرى.",
        429,
        { code: "RATE_LIMITED" }
      );
    }
    return null;
  } catch (e) {
    console.error("[AniDoa] Rate limiter failed:", e && e.message);
    return errorResponse("تعذّر التحقق من حد الطلبات حالياً. حاول بعد قليل.", 503);
  }
}

async function kvGetJson(env, key) {
  if (!env || !env.ANIDOA_KV) return null;
  try {
    const raw = await env.ANIDOA_KV.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("[AniDoa] KV get failed for " + key + ":", e && e.message);
    return null;
  }
}

async function kvPutJson(env, key, value) {
  if (!env || !env.ANIDOA_KV) {
    throw new Error("ربط KV غير متاح. تأكد من ربط ANIDOA_KV بالـ Worker.");
  }
  await env.ANIDOA_KV.put(key, JSON.stringify(value));
}

async function kvDelete(env, key) {
  if (!env || !env.ANIDOA_KV) return;
  await env.ANIDOA_KV.delete(key);
}

async function listSeriesIndex(env) {
  const index = await kvGetJson(env, "series:index");
  if (!Array.isArray(index)) return [];
  return index;
}

async function saveSeriesIndex(env, index) {
  await kvPutJson(env, "series:index", index);
}

async function isApprovedEpisode(env, playlistId, videoId) {
  if (!isValidPlaylistId(playlistId) || !isValidVideoId(videoId)) return false;
  const series = await kvGetJson(env, "playlist:" + playlistId);
  return !!(
    series &&
    Array.isArray(series.episodes) &&
    series.episodes.some((episode) => episode && episode.videoId === videoId)
  );
}

/**
 * جلب عنوان قائمة التشغيل من YouTube Data API.
 */
async function fetchPlaylistTitle(playlistId, apiKey) {
  const url =
    YOUTUBE_API_BASE +
    "/playlists?part=snippet&id=" +
    encodeURIComponent(playlistId) +
    "&key=" +
    encodeURIComponent(apiKey);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("تم رفض طلب YouTube (403). تحقق من مفتاح YOUTUBE_API_KEY أو رصيد الحصة اليومية (Quota).");
    }
    if (response.status === 404) {
      throw new Error("قائمة التشغيل غير موجودة.");
    }
    throw new Error("فشل جلب بيانات قائمة التشغيل من يوتيوب (HTTP " + response.status + ").");
  }
  const data = await response.json();
  const item = data && data.items && data.items[0];
  if (!item) throw new Error("قائمة التشغيل غير موجودة أو خاصة.");
  const snippet = item.snippet || {};
  const thumbnails = snippet.thumbnails || {};
  const thumb = (thumbnails.high && thumbnails.high.url) || (thumbnails.medium && thumbnails.medium.url) || (thumbnails.default && thumbnails.default.url) || "";
  return { title: snippet.title || "مسلسل بدون عنوان", thumbnail: thumb };
}

/**
 * جلب كل حلقات قائمة التشغيل بالترتيب (صفحات 50 حلقة).
 */
async function fetchPlaylistEpisodes(playlistId, apiKey) {
  const episodes = [];
  let pageToken = "";
  let guard = 0;
  while (guard < 40) {
    guard++;
    let url =
      YOUTUBE_API_BASE +
      "/playlistItems?part=snippet&maxResults=50&playlistId=" +
      encodeURIComponent(playlistId) +
      "&key=" +
      encodeURIComponent(apiKey);
    if (pageToken) url += "&pageToken=" + encodeURIComponent(pageToken);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("تم رفض طلب YouTube (403). قد تكون حصة YouTube API اليومية قد انتهت — حاول لاحقاً.");
      }
      if (response.status === 404) {
        throw new Error("قائمة التشغيل غير موجودة.");
      }
      throw new Error("فشل جلب حلقات قائمة التشغيل (HTTP " + response.status + ").");
    }
    const data = await response.json();
    const items = (data && data.items) || [];
    for (const item of items) {
      const snippet = item && item.snippet;
      if (!snippet) continue;
      const videoId = snippet.resourceId && snippet.resourceId.videoId;
      if (!videoId) continue;
      const thumbnails = snippet.thumbnails || {};
      const thumb =
        (thumbnails.medium && thumbnails.medium.url) ||
        (thumbnails.high && thumbnails.high.url) ||
        (thumbnails.default && thumbnails.default.url) ||
        "";
      episodes.push({
        videoId,
        title: snippet.title || "حلقة بدون عنوان",
        thumbnail: thumb,
        position: typeof snippet.position === "number" ? snippet.position : episodes.length,
        publishedAt: snippet.publishedAt || "",
      });
    }
    pageToken = (data && data.nextPageToken) || "";
    if (!pageToken) break;
  }
  episodes.sort((a, b) => a.position - b.position);
  episodes.forEach((ep, i) => {
    ep.position = i;
  });
  return episodes;
}

async function fetchAndStoreSeries(playlistId, env) {
  const apiKey = env && env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("مفتاح YouTube غير مضبوط. أضف YOUTUBE_API_KEY من لوحة تحكم Cloudflare.");
  }
  const meta = await fetchPlaylistTitle(playlistId, apiKey);
  const episodes = await fetchPlaylistEpisodes(playlistId, apiKey);
  if (episodes.length === 0) {
    throw new Error("قائمة التشغيل فارغة أو كل حلقاتها خاصة.");
  }
  const series = {
    playlistId,
    title: meta.title,
    thumbnail: meta.thumbnail || (episodes[0] && episodes[0].thumbnail) || "",
    episodes,
    fetchedAt: new Date().toISOString(),
  };
  await kvPutJson(env, "playlist:" + playlistId, series);
  const index = await listSeriesIndex(env);
  const existingAt = index.findIndex((s) => s.playlistId === playlistId);
  const entry = {
    playlistId,
    title: series.title,
    thumbnail: series.thumbnail,
    episodeCount: episodes.length,
    addedAt: existingAt >= 0 ? index[existingAt].addedAt : new Date().toISOString(),
  };
  if (existingAt >= 0) index[existingAt] = entry;
  else index.unshift(entry);
  await saveSeriesIndex(env, index);
  return series;
}

async function handleAddSeries(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("بيانات الطلب غير صالحة — أرسل JSON صحيحاً.", 400);
  }
  const admin = requireAdmin(request, env, body && body.adminSecret);
  if (!admin.ok) return errorResponse(admin.error, 401);
  const playlistId = extractPlaylistId((body && (body.playlistUrl || body.playlistId)) || "");
  if (!playlistId) {
    return errorResponse("رابط قائمة التشغيل غير صالح. الصق رابط يوتيوب يحتوي على list= أو معرّف القائمة.", 400);
  }
  try {
    const series = await fetchAndStoreSeries(playlistId, env);
    return jsonResponse({
      ok: true,
      message: "تمت إضافة المسلسل بنجاح.",
      series: {
        playlistId: series.playlistId,
        title: series.title,
        thumbnail: series.thumbnail,
        episodeCount: series.episodes.length,
      },
    });
  } catch (e) {
    console.error("[AniDoa] Add series failed:", e && e.message);
    return errorResponse(e.message || "فشلت إضافة المسلسل.", 502);
  }
}

async function handleDeleteSeries(request, env, url) {
  const admin = requireAdmin(request, env, null);
  if (!admin.ok) return errorResponse(admin.error, 401);
  const playlistId = url.searchParams.get("playlistId");
  if (!playlistId) return errorResponse("حدد playlistId للحذف.", 400);
  await kvDelete(env, "playlist:" + playlistId);
  const index = await listSeriesIndex(env);
  const next = index.filter((s) => s.playlistId !== playlistId);
  await saveSeriesIndex(env, next);
  return jsonResponse({ ok: true, message: "تم حذف المسلسل." });
}

async function handleGetSubtitles(request, env, url) {
  const playlistId = url.searchParams.get("playlistId");
  const videoId = url.searchParams.get("videoId");
  if (!isValidPlaylistId(playlistId) || !isValidVideoId(videoId)) {
    return errorResponse("رابط المسلسل أو معرّف الحلقة غير صالح.", 400);
  }
  if (!(await isApprovedEpisode(env, playlistId, videoId))) {
    return errorResponse("هذه الحلقة غير موجودة ضمن مسلسلات AniDoa المعتمدة.", 404, {
      code: "EPISODE_NOT_FOUND",
    });
  }
  const cached = await kvGetJson(env, "sub:" + videoId);
  if (cached && Array.isArray(cached.subtitles) && cached.subtitles.length > 0) {
    return jsonResponse({
      videoId,
      source: cached.source || "cache",
      cached: true,
      translatedAt: cached.translatedAt || null,
      subtitles: cached.subtitles,
    });
  }
  const rateLimitResponse = await checkTranslationRateLimit(request, env, "subtitles");
  if (rateLimitResponse) return rateLimitResponse;

  let english;
  try {
    english = await getEnglishSubtitles(videoId, env);
  } catch (e) {
    if (e instanceof NoSubtitlesError || (e && e.code === "NO_SUBTITLES")) {
      return errorResponse(
        "تعذّر العثور على ترجمة إنجليزية لهذه الحلقة. قد تكون الحلقة بدون ترجمة (Hardsub). يمكنك رفع ملف .srt أو لصق نص الترجمة ليترجمها السيرفر فوراً.",
        404,
        { code: "NO_SUBTITLES", manual: true }
      );
    }
    console.error("[AniDoa] Subtitle fetch failed:", e && e.message);
    return errorResponse("تعذّر سحب ترجمة الحلقة. حاول مرة أخرى.", 502);
  }
  let translated;
  try {
    translated = await translateSubtitles(english.cues, env);
  } catch (e) {
    console.error("[AniDoa] Translation failed:", e && e.message);
    return errorResponse(e.message || "فشلت ترجمة الحلقة. حاول مرة أخرى.", 502);
  }
  const record = {
    videoId,
    source: english.source,
    translatedAt: new Date().toISOString(),
    subtitles: translated,
  };
  try {
    await kvPutJson(env, "sub:" + videoId, record);
  } catch (e) {
    console.error("[AniDoa] KV subtitle cache failed:", e && e.message);
  }
  return jsonResponse({ videoId, source: english.source, cached: false, translatedAt: record.translatedAt, subtitles: translated });
}

async function handleTranslateManual(request, env) {
  const admin = requireAdmin(request, env, null);
  if (!admin.ok) return errorResponse(admin.error, 401);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_MANUAL_REQUEST_BYTES) {
    return errorResponse("الطلب أكبر من الحد المسموح (500KB للترجمة).", 413);
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch (e) {
    return errorResponse("تعذّر قراءة بيانات الطلب.", 400);
  }
  if (new TextEncoder().encode(rawBody).length > MAX_MANUAL_REQUEST_BYTES) {
    return errorResponse("الطلب أكبر من الحد المسموح (500KB للترجمة).", 413);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    return errorResponse("بيانات الطلب غير صالحة.", 400);
  }

  const playlistId = body && body.playlistId;
  const videoId = body && body.videoId;
  const srtText = body && (body.srtText || body.text || "");
  if (!isValidPlaylistId(playlistId) || !isValidVideoId(videoId)) {
    return errorResponse("رابط المسلسل أو معرّف الحلقة غير صالح.", 400);
  }
  if (!(await isApprovedEpisode(env, playlistId, videoId))) {
    return errorResponse("هذه الحلقة غير موجودة ضمن مسلسلات AniDoa المعتمدة.", 404, {
      code: "EPISODE_NOT_FOUND",
    });
  }

  const cached = await kvGetJson(env, "sub:" + videoId);
  if (cached && Array.isArray(cached.subtitles) && cached.subtitles.length > 0) {
    return jsonResponse({
      videoId,
      source: cached.source || "cache",
      cached: true,
      translatedAt: cached.translatedAt || null,
      subtitles: cached.subtitles,
    });
  }

  if (!srtText || typeof srtText !== "string" || srtText.trim().length < 10) {
    return errorResponse("نص الترجمة فارغ أو قصير جداً. الصق ملف ترجمة كاملاً.", 400);
  }
  if (new TextEncoder().encode(srtText).length > MAX_MANUAL_TEXT_BYTES) {
    return errorResponse("ملف الترجمة أكبر من الحد المسموح (500KB).", 413);
  }

  let cues = [];
  if (srtText.trim().startsWith("WEBVTT")) {
    cues = parseVTT(srtText);
  } else {
    cues = parseSRT(srtText);
    if (cues.length === 0) cues = parseVTT(srtText);
  }
  if (cues.length === 0) {
    return errorResponse("تعذّر فهم ملف الترجمة. تأكد أنه بصيغة SRT أو VTT صحيحة.", 400);
  }

  const rateLimitResponse = await checkTranslationRateLimit(request, env, "manual");
  if (rateLimitResponse) return rateLimitResponse;

  let translated;
  try {
    translated = await translateSubtitles(cues, env);
  } catch (e) {
    console.error("[AniDoa] Manual translation failed:", e && e.message);
    return errorResponse(e.message || "فشلت ترجمة الملف المرفوع.", 502);
  }
  const record = {
    videoId,
    source: "manual",
    translatedAt: new Date().toISOString(),
    subtitles: translated,
  };
  try {
    await kvPutJson(env, "sub:" + videoId, record);
  } catch (e) {
    console.error("[AniDoa] KV manual cache failed:", e && e.message);
  }
  return jsonResponse({ videoId, source: "manual", cached: false, translatedAt: record.translatedAt, subtitles: translated });
}

async function handleHome(env) {
  const seriesList = await listSeriesIndex(env);
  return htmlResponse(renderHome(seriesList));
}

async function handleWatch(env, url) {
  let playlistId = url.searchParams.get("playlist") || "";
  let videoId = url.searchParams.get("episode") || "";
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length >= 2 && pathParts[0] === "watch") {
    playlistId = playlistId || pathParts[1] || "";
    videoId = videoId || pathParts[2] || "";
  }
  if (!isValidPlaylistId(playlistId)) {
    return htmlResponse(renderErrorPage("رابط المسلسل غير صالح", "ارجع إلى الرئيسية واختر مسلسلاً من المكتبة."), 400);
  }

  // Never fetch arbitrary YouTube playlists from a public watch URL.
  // Only playlists explicitly imported by an authenticated administrator are watchable.
  const series = await kvGetJson(env, "playlist:" + playlistId);
  if (!series) {
    return htmlResponse(
      renderErrorPage("المسلسل غير موجود في المكتبة", "يجب على المدير إضافة قائمة التشغيل أولاً من الصفحة الرئيسية."),
      404
    );
  }

  const episodes = Array.isArray(series.episodes) ? series.episodes : [];
  if (episodes.length === 0) {
    return htmlResponse(renderErrorPage("المسلسل بلا حلقات", "قائمة التشغيل فارغة."), 404);
  }
  if (videoId && !isValidVideoId(videoId)) {
    return htmlResponse(renderErrorPage("رابط الحلقة غير صالح", "ارجع إلى قائمة الحلقات واختر حلقة صحيحة."), 400);
  }
  const episode = videoId ? episodes.find((ep) => ep.videoId === videoId) : episodes[0];
  if (!episode) {
    return htmlResponse(renderErrorPage("الحلقة غير موجودة", "اختر حلقة من قائمة حلقات المسلسل."), 404);
  }
  return htmlResponse(renderWatchPage(series, episode, episodes));
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();

      if (path === "/api/health" && method === "GET") {
        return jsonResponse({ ok: true, service: "anidoa", time: new Date().toISOString() });
      }

      if (path === "/api/series" && method === "GET") {
        const seriesList = await listSeriesIndex(env);
        return jsonResponse({ series: seriesList });
      }

      if (path === "/api/series" && method === "POST") {
        return await handleAddSeries(request, env);
      }

      if (path === "/api/series" && method === "DELETE") {
        return await handleDeleteSeries(request, env, url);
      }

      if (path === "/api/subtitles" && method === "GET") {
        return await handleGetSubtitles(request, env, url);
      }

      if (path === "/api/translate-manual" && method === "POST") {
        return await handleTranslateManual(request, env);
      }

      if (path === "/" && method === "GET") {
        return await handleHome(env);
      }

      if ((path === "/watch" || path.startsWith("/watch/")) && method === "GET") {
        return await handleWatch(env, url);
      }

      if (path.startsWith("/api/")) {
        return errorResponse("المسار غير موجود.", 404);
      }

      return htmlResponse(renderErrorPage("الصفحة غير موجودة", "الرابط الذي فتحته غير صحيح."), 404);
    } catch (e) {
      console.error("[AniDoa] Unhandled error:", e && e.stack ? e.stack : e);
      if (request.url.includes("/api/")) {
        return errorResponse("حدث خطأ غير متوقع في السيرفر.", 500);
      }
      return htmlResponse(renderErrorPage("حدث خطأ غير متوقع", "حاول تحديث الصفحة."), 500);
    }
  },
};
