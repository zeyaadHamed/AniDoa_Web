/**
 * AniDoa — src/index.js
 * Cloudflare Worker الرئيسي: التوجيه، YouTube Data API، التخزين في KV، الترجمة.
 *
 * البنية:
 *   KV: series:index            → فهرس المسلسلات [{playlistId,title,thumbnail,episodeCount,addedAt,truncated}]
 *   KV: playlist:{playlistId}   → تفاصيل المسلسل {playlistId,title,episodes:[...],fetchedAt,truncated,totalFetched}
 *   KV: sub:{videoId}           → الترجمة العربية الجاهزة {videoId,source,translatedAt,subtitles}
 *   KV: rl:{ip}:{hourBucket}    → عدّاد حدود الترجمة لكل IP (15/ساعة، تقريبي)
 *   KV: rl:global:{dayBucket}   → عدّاد الحد اليومي العام (500/يوم، تقريبي)
 *
 * نموذج الحماية (v2):
 * - صفحة المشاهدة تعمل فقط لمسلسلات موجودة في المكتبة — لا يُستدعى YouTube API
 *   أبداً من رابط مشاهدة عشوائي، فلا يمكن استنزاف الحصة اليومية بروابط خارجية.
 * - الترجمة (التلقائية واليدوية) تتطلب أن تكون الحلقة عضواً في مسلسل بالمكتبة.
 * - الترجمة اليدوية محمية بكلمة سر المدير.
 * - حد تقريبي لطلبات الترجمة غير المخزّنة: 15/ساعة لكل IP و 500/يوم إجمالاً.
 * - ترويسات أمان على كل الردود.
 *
 * المتغيرات المطلوبة (Secrets من Dashboard):
 *   YOUTUBE_API_KEY, GEMINI_API_KEY, ADMIN_SECRET, SUPADATA_API_KEY (اختياري)
 * متغيرات عادية (Vars من Dashboard — ليست Secrets):
 *   GEMINI_MODEL (اختياري — تجاوز نموذج الترجمة، الافتراضي gemini-3.5-flash-lite)
 * الربط المطلوب:
 *   ANIDOA_KV (KVNamespace)
 */

import { getEnglishSubtitles, parseSRT, parseVTT, NoSubtitlesError } from "./subtitles.js";
import { translateSubtitles, getActiveModel } from "./translator.js";
import { renderHome, renderWatchPage, renderErrorPage, logoSVG } from "./ui.js";
import {
  withSecurityHeaders,
  extractPlaylistId,
  isValidVideoId,
  isValidPlaylistId,
  timingSafeEqual,
  getClientIp,
  hourBucket,
  dayBucket,
  rateLimitKey,
} from "./security.js";

// إعادة تصدير للتوافق مع الإصدار الأول (كان extractPlaylistId يُصدَّر من هنا).
export { extractPlaylistId } from "./security.js";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const MAX_MANUAL_TEXT_BYTES = 500 * 1024;
const MAX_EPISODES_PER_SERIES = 500;
const RATE_LIMIT_PER_IP_PER_HOUR = 15;
const RATE_LIMIT_GLOBAL_PER_DAY = 500;

function jsonResponse(data, status, extraHeaders) {
  const response = new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  return withSecurityHeaders(response, extraHeaders);
}

function errorResponse(message, status, extra, extraHeaders) {
  const body = { error: message || "حدث خطأ غير متوقع" };
  if (extra) Object.assign(body, extra);
  return jsonResponse(body, status || 500, extraHeaders);
}

function htmlResponse(html, status) {
  const response = new Response(html, {
    status: status || 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
  return withSecurityHeaders(response);
}

function requireAdmin(request, env, bodySecret) {
  const configured = env && env.ADMIN_SECRET;
  if (!configured) {
    return { ok: false, error: "لم يتم ضبط كلمة سر المدير (ADMIN_SECRET) في إعدادات Worker بعد." };
  }
  const headerSecret = request.headers.get("x-admin-secret");
  const provided = bodySecret || headerSecret || "";
  if (!timingSafeEqual(provided, configured)) {
    return { ok: false, error: "كلمة سر المدير غير صحيحة." };
  }
  return { ok: true };
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

function secondsUntilHourEnd(now) {
  const d = now || new Date();
  return 3600 - (d.getUTCMinutes() * 60 + d.getUTCSeconds());
}

function secondsUntilDayEnd(now) {
  const d = now || new Date();
  return 86400 - (d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds());
}

async function readCounter(env, key) {
  if (!env || !env.ANIDOA_KV) return 0;
  try {
    const raw = await env.ANIDOA_KV.get(key);
    const n = parseInt(raw || "0", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) {
    console.error("[AniDoa] Rate-limit read failed for " + key + ":", e && e.message);
    return 0;
  }
}

async function incrementCounter(env, key, expirationTtl) {
  if (!env || !env.ANIDOA_KV) return;
  const current = await readCounter(env, key);
  try {
    await env.ANIDOA_KV.put(key, String(current + 1), { expirationTtl });
  } catch (e) {
    console.error("[AniDoa] Rate-limit write failed for " + key + ":", e && e.message);
  }
}

/**
 * حد تقريبي لطلبات الترجمة غير المخزّنة (سحب+ترجمة جديدة وترجمة يدوية):
 * 15 طلباً/ساعة لكل IP و 500 طلب/يوم إجمالاً للمنصة.
 * الترجمات المخزنة في KV تتجاوز الحد تماماً (لا تُحسب ولا تُفحص).
 *
 * تحذير — الحد تقريبي وليس صارماً: Cloudflare KV متسق في النهاية
 * (eventually consistent) وقد تتسابق الزيادات المتزامنة من مناطق مختلفة
 * فتضيع بعض الزيادات، وقد تتأخر القراءة عن الكتابة. هذا كافٍ لتقليل
 * إساءة الاستخدام والتكاليف، لكنه لا يضمن حداً دقيقاً بالوحدة.
 */
async function checkRateLimit(env, request) {
  if (!env || !env.ANIDOA_KV) return { allowed: true };
  const now = new Date();
  const ip = getClientIp(request);
  const ipKey = rateLimitKey("rl", ip, hourBucket(now));
  const globalKey = rateLimitKey("rl", "global", dayBucket(now));
  const ipCount = await readCounter(env, ipKey);
  if (ipCount >= RATE_LIMIT_PER_IP_PER_HOUR) {
    return { allowed: false, scope: "ip", retryAfter: secondsUntilHourEnd(now) };
  }
  const globalCount = await readCounter(env, globalKey);
  if (globalCount >= RATE_LIMIT_GLOBAL_PER_DAY) {
    return { allowed: false, scope: "global", retryAfter: secondsUntilDayEnd(now) };
  }
  await incrementCounter(env, ipKey, 3600);
  await incrementCounter(env, globalKey, 86400);
  return { allowed: true };
}

function rateLimitResponse(result) {
  const message =
    result.scope === "global"
      ? "تم تجاوز الحد اليومي العام للترجمة (500 طلب/يوم). حاول مجدداً غداً."
      : "تم تجاوز حد الترجمة المؤقت (15 طلب ترجمة/ساعة). حاول بعد قليل.";
  return errorResponse(
    message,
    429,
    { code: "RATE_LIMITED", retryAfter: result.retryAfter },
    { "Retry-After": String(result.retryAfter) }
  );
}

/**
 * التحقق من عضوية حلقة في المكتبة.
 * يُرجع {series} عند النجاح أو {errorResponse} جاهزاً للإرجاع عند الفشل.
 */
async function requireLibraryEpisode(env, playlistId, videoId) {
  const series = await kvGetJson(env, "playlist:" + playlistId);
  if (!series) {
    return {
      errorResponse: errorResponse("المسلسل غير موجود في المكتبة.", 404, { code: "NOT_IN_LIBRARY" }),
    };
  }
  const episodes = Array.isArray(series.episodes) ? series.episodes : [];
  if (!episodes.some((ep) => ep.videoId === videoId)) {
    return {
      errorResponse: errorResponse("الحلقة غير موجودة في مكتبة AniDoa.", 404, { code: "NOT_IN_LIBRARY" }),
    };
  }
  return { series };
}

async function listSeriesIndex(env) {
  const index = await kvGetJson(env, "series:index");
  if (!Array.isArray(index)) return [];
  return index;
}

async function saveSeriesIndex(env, index) {
  await kvPutJson(env, "series:index", index);
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
 * جلب حلقات قائمة التشغيل بالترتيب (صفحات 50 حلقة).
 * يُوقف عند 500 حلقة كحد أقصى لكل مسلسل (لحماية KV وحصة YouTube API)،
 * ويُرجع {episodes, truncated, totalAvailable, totalFetched}.
 */
async function fetchPlaylistEpisodes(playlistId, apiKey) {
  const episodes = [];
  let pageToken = "";
  let guard = 0;
  let truncated = false;
  let totalAvailable = null;
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
    if (totalAvailable === null && data && data.pageInfo && typeof data.pageInfo.totalResults === "number") {
      totalAvailable = data.pageInfo.totalResults;
    }
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
    if (episodes.length >= MAX_EPISODES_PER_SERIES) {
      truncated = Boolean(data && data.nextPageToken);
      break;
    }
    pageToken = (data && data.nextPageToken) || "";
    if (!pageToken) break;
  }
  episodes.sort((a, b) => a.position - b.position);
  const capped = episodes.slice(0, MAX_EPISODES_PER_SERIES);
  capped.forEach((ep, i) => {
    ep.position = i;
  });
  return { episodes: capped, truncated, totalAvailable, totalFetched: capped.length };
}

async function fetchAndStoreSeries(playlistId, env) {
  const apiKey = env && env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("مفتاح YouTube غير مضبوط. أضف YOUTUBE_API_KEY من لوحة تحكم Cloudflare.");
  }
  const meta = await fetchPlaylistTitle(playlistId, apiKey);
  const fetched = await fetchPlaylistEpisodes(playlistId, apiKey);
  const episodes = fetched.episodes;
  if (episodes.length === 0) {
    throw new Error("قائمة التشغيل فارغة أو كل حلقاتها خاصة.");
  }
  const series = {
    playlistId,
    title: meta.title,
    thumbnail: meta.thumbnail || (episodes[0] && episodes[0].thumbnail) || "",
    episodes,
    fetchedAt: new Date().toISOString(),
    truncated: fetched.truncated,
    totalFetched: fetched.totalFetched,
    totalAvailable: fetched.totalAvailable,
  };
  await kvPutJson(env, "playlist:" + playlistId, series);
  const index = await listSeriesIndex(env);
  const existingAt = index.findIndex((s) => s.playlistId === playlistId);
  const entry = {
    playlistId,
    title: series.title,
    thumbnail: series.thumbnail,
    episodeCount: episodes.length,
    truncated: fetched.truncated,
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

async function handleRefreshSeries(request, env) {
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
  const existing = await kvGetJson(env, "playlist:" + playlistId);
  if (!existing) {
    return errorResponse("المسلسل غير موجود في المكتبة. أضفه أولاً عبر إضافة مسلسل جديد.", 404, {
      code: "NOT_IN_LIBRARY",
    });
  }
  try {
    const series = await fetchAndStoreSeries(playlistId, env);
    return jsonResponse({
      ok: true,
      message: "تم تحديث المسلسل بنجاح.",
      playlistId: series.playlistId,
      episodeCount: series.episodes.length,
      truncated: series.truncated,
    });
  } catch (e) {
    console.error("[AniDoa] Refresh series failed:", e && e.message);
    return errorResponse(e.message || "فشل تحديث المسلسل.", 502);
  }
}

async function handleGetSubtitles(request, env, url) {
  const videoId = url.searchParams.get("videoId");
  const playlistId = url.searchParams.get("playlist");
  if (!isValidVideoId(videoId) || !isValidPlaylistId(playlistId)) {
    return errorResponse("معرّف الفيديو أو المسلسل غير صالح.", 400, { code: "INVALID_INPUT" });
  }
  const membership = await requireLibraryEpisode(env, playlistId, videoId);
  if (membership.errorResponse) return membership.errorResponse;
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
  const limit = await checkRateLimit(env, request);
  if (!limit.allowed) return rateLimitResponse(limit);
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
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("بيانات الطلب غير صالحة.", 400);
  }
  const videoId = body && body.videoId;
  const playlistId = body && body.playlistId;
  const srtText = body && (body.srtText || body.text || "");
  if (!isValidVideoId(videoId) || !isValidPlaylistId(playlistId)) {
    return errorResponse("معرّف الفيديو أو المسلسل غير صالح.", 400, { code: "INVALID_INPUT" });
  }
  const admin = requireAdmin(request, env, body && body.adminSecret);
  if (!admin.ok) return errorResponse(admin.error, 403, { code: "FORBIDDEN" });
  const membership = await requireLibraryEpisode(env, playlistId, videoId);
  if (membership.errorResponse) return membership.errorResponse;
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
  const limit = await checkRateLimit(env, request);
  if (!limit.allowed) return rateLimitResponse(limit);
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
  if (!playlistId) {
    return htmlResponse(renderErrorPage("لم يتم تحديد المسلسل", "ارجع إلى الرئيسية واختر مسلسلاً للمشاهدة."), 400);
  }
  if (!isValidPlaylistId(playlistId)) {
    return htmlResponse(
      renderErrorPage("المسلسل غير موجود في مكتبة AniDoa", "اختر مسلسلاً من المكتبة للمشاهدة."),
      404
    );
  }
  // المكتبة فقط: لا يُستدعى YouTube API أبداً من رابط مشاهدة، حتى لا يستهلك
  // رابط عشوائي حصة YouTube اليومية. المسلسلات تُضاف من لوحة المدير فقط.
  const series = await kvGetJson(env, "playlist:" + playlistId);
  if (!series) {
    return htmlResponse(
      renderErrorPage(
        "المسلسل غير موجود في مكتبة AniDoa",
        "هذا المسلسل غير مضاف إلى المكتبة بعد. اختر مسلسلاً من المكتبة للمشاهدة."
      ),
      404
    );
  }
  const episodes = Array.isArray(series.episodes) ? series.episodes : [];
  if (episodes.length === 0) {
    return htmlResponse(renderErrorPage("المسلسل بلا حلقات", "قائمة التشغيل فارغة."), 404);
  }
  let episode = episodes.find((ep) => ep.videoId === videoId);
  if (!episode) episode = episodes[0];
  return htmlResponse(renderWatchPage(series, episode, episodes));
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();

      if (path === "/api/health" && method === "GET") {
        let kvStatus = "error";
        try {
          if (env && env.ANIDOA_KV) {
            await env.ANIDOA_KV.get("series:index");
            kvStatus = "ok";
          }
        } catch (e) {
          kvStatus = "error";
        }
        return jsonResponse({
          ok: true,
          service: "anidoa",
          kv: kvStatus,
          model: getActiveModel(env),
          time: new Date().toISOString(),
        });
      }

      if (path === "/robots.txt" && method === "GET") {
        return withSecurityHeaders(
          new Response("User-agent: *\nDisallow: /api/\n", {
            headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "max-age=86400" },
          })
        );
      }

      if (path === "/favicon.svg" && method === "GET") {
        return withSecurityHeaders(
          new Response(logoSVG(64), {
            headers: { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" },
          })
        );
      }

      if (path === "/api/series" && method === "GET") {
        const seriesList = await listSeriesIndex(env);
        return jsonResponse({ series: seriesList });
      }

      if (path === "/api/series" && method === "POST") {
        return await handleAddSeries(request, env);
      }

      if (path === "/api/series/refresh" && method === "POST") {
        return await handleRefreshSeries(request, env);
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
