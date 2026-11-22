/**
 * AniDoa — subtitles.js
 * سحب ملفات الترجمة الإنجليزية من يوتيوب بنظام Fallback متدرج (4 مستويات).
 *
 * المستوى 1: YouTube Innertube API مباشرة (Android ثم iOS)
 * المستوى 2: Piped API / Invidious API مع تدوير بين السيرفرات
 * المستوى 3: Supadata API (اختياري عبر SUPADATA_API_KEY)
 * المستوى 4: رمي NoSubtitlesError — الواجهة تعرض رفع ملف SRT يدوياً
 */

// مفتاح Innertube العام المضمّن في تطبيقات يوتيوب (ليس مفتاحاً سرياً خاصاً بالمستخدم)
const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?key=" + INNERTUBE_API_KEY;

const PIPED_SERVERS = [
  "https://piped.video",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi-libre.kavin.rocks",
];

const INVIDIOUS_SERVERS = [
  "https://inv.nadeko.net",
  "https://invidious.privacyredirect.com",
  "https://iv.datura.network",
];

export class NoSubtitlesError extends Error {
  constructor(message) {
    super(message || "لا توجد ترجمة إنجليزية متاحة لهذه الحلقة");
    this.name = "NoSubtitlesError";
    this.code = "NO_SUBTITLES";
  }
}

/**
 * fetch مع مهلة زمنية (Timeout) عبر AbortController.
 */
export async function fetchWithTimeout(url, options, timeoutMs) {
  const timeout = timeoutMs || 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...(options || {}), signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * تحويل توقيت SRT/VTT مثل "00:01:23,456" أو "01:23.456" إلى ثوانٍ.
 */
export function srtTimeToSeconds(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return 0;
  const cleaned = timeStr.trim().replace(",", ".");
  const parts = cleaned.split(":");
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    seconds = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  } else {
    seconds = parseFloat(parts[0]);
  }
  if (Number.isNaN(seconds) || seconds < 0) return 0;
  return Math.round(seconds * 1000) / 1000;
}

/**
 * تنظيف نص الترجمة: إزالة وسوم HTML، فك كيانات HTML، إزالة أسطر فارغة.
 */
export function cleanCueText(text) {
  if (!text || typeof text !== "string") return "";
  let out = text;
  out = out.replace(/<[^>]*>/g, "");
  out = out.replace(/&amp;/g, "&");
  out = out.replace(/&lt;/g, "<");
  out = out.replace(/&gt;/g, ">");
  out = out.replace(/&quot;/g, '"');
  out = out.replace(/&#39;/g, "'");
  out = out.replace(/&nbsp;/g, " ");
  out = out.replace(/\{\\[^}]*\}/g, "");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

/**
 * دمج وحذف التكرار: حذف الأسطر الفارغة، دمج الأسطر بنفس التوقيت، ترتيب حسب البداية.
 */
export function dedupeAndSortCues(cues) {
  if (!Array.isArray(cues)) return [];
  const cleaned = [];
  for (const cue of cues) {
    if (!cue) continue;
    const start = Number(cue.start);
    const end = Number(cue.end);
    const text = cleanCueText(cue.text || "");
    if (!text) continue;
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    if (end <= start) continue;
    cleaned.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, text });
  }
  cleaned.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const cue of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.start === cue.start && last.end === cue.end) {
      if (!last.text.includes(cue.text)) {
        last.text = (last.text + " " + cue.text).trim();
      }
      continue;
    }
    if (last && last.text === cue.text && cue.start - last.end < 0.3) {
      last.end = cue.end;
      continue;
    }
    merged.push({ ...cue });
  }
  return merged;
}

/**
 * تحليل ملف SRT كامل إلى مصفوفة cues.
 */
export function parseSRT(text) {
  if (!text || typeof text !== "string") return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    let timeLineIndex = 0;
    if (/^\d+$/.test(lines[0])) {
      timeLineIndex = 1;
    }
    if (timeLineIndex >= lines.length) continue;
    const timeLine = lines[timeLineIndex];
    const match = timeLine.match(/(.+?)\s*-->\s*(.+)/);
    if (!match) continue;
    const start = srtTimeToSeconds(match[1].trim());
    const end = srtTimeToSeconds(match[2].trim().split(/\s+/)[0]);
    const textLines = lines.slice(timeLineIndex + 1);
    const cueText = cleanCueText(textLines.join(" "));
    if (!cueText) continue;
    cues.push({ start, end, text: cueText });
  }
  return dedupeAndSortCues(cues);
}

/**
 * تحليل ملف WebVTT إلى مصفوفة cues.
 */
export function parseVTT(text) {
  if (!text || typeof text !== "string") return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const cues = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line === "WEBVTT" || line.startsWith("NOTE") || line.startsWith("STYLE") || line.startsWith("REGION")) {
      i++;
      continue;
    }
    let timeLine = line;
    if (!timeLine.includes("-->")) {
      i++;
      if (i >= lines.length) break;
      timeLine = lines[i].trim();
      if (!timeLine.includes("-->")) continue;
    }
    const match = timeLine.match(/(.+?)\s*-->\s*(.+)/);
    if (!match) {
      i++;
      continue;
    }
    const start = srtTimeToSeconds(match[1].trim());
    const end = srtTimeToSeconds(match[2].trim().split(/\s+/)[0]);
    i++;
    const textParts = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textParts.push(lines[i].trim());
      i++;
    }
    const cueText = cleanCueText(textParts.join(" "));
    if (cueText && end > start) {
      cues.push({ start, end, text: cueText });
    }
    i++;
  }
  return dedupeAndSortCues(cues);
}

/**
 * تحليل XML بصيغة YouTube TimedText.
 * مثال: <transcript><text start="1.2" dur="2.3">Hello</text>...</transcript>
 */
export function parseTimedTextXML(xmlText) {
  if (!xmlText || typeof xmlText !== "string") return [];
  const cues = [];
  const textTagRegex = /<text[^>]*start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = textTagRegex.exec(xmlText)) !== null) {
    const start = parseFloat(match[1]);
    const dur = parseFloat(match[2]);
    const text = cleanCueText(match[3] || "");
    if (!text || Number.isNaN(start) || Number.isNaN(dur)) continue;
    cues.push({ start, end: Math.round((start + dur) * 1000) / 1000, text });
  }
  if (cues.length === 0) {
    const altRegex = /<p[^>]*begin="([\d:.]+)"[^>]*end="([\d:.]+)"[^>]*>([\s\S]*?)<\/p>/g;
    while ((match = altRegex.exec(xmlText)) !== null) {
      const start = srtTimeToSeconds(match[1]);
      const end = srtTimeToSeconds(match[2]);
      const text = cleanCueText(match[3] || "");
      if (!text) continue;
      cues.push({ start, end, text });
    }
  }
  return dedupeAndSortCues(cues);
}

/**
 * تحليل JSON3 من يوتيوب: { events: [{ tStartMs, dDurationMs, segs: [{ utf8 }] }] }
 */
export function parseJson3(json3) {
  if (!json3 || !Array.isArray(json3.events)) return [];
  const cues = [];
  for (const event of json3.events) {
    if (!event || !Array.isArray(event.segs)) continue;
    if (typeof event.tStartMs !== "number") continue;
    const text = cleanCueText(event.segs.map((s) => (s && s.utf8) || "").join(""));
    if (!text) continue;
    const start = event.tStartMs / 1000;
    const durationMs = typeof event.dDurationMs === "number" ? event.dDurationMs : 2000;
    const end = (event.tStartMs + durationMs) / 1000;
    cues.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, text });
  }
  return dedupeAndSortCues(cues);
}

/**
 * اختيار أفضل مسار ترجمة إنجليزي من قائمة captionTracks.
 * الأفضلية: en اليدوية، ثم en-US / en-GB، ثم a.en التلقائية.
 */
function pickEnglishTrack(captionTracks) {
  if (!Array.isArray(captionTracks) || captionTracks.length === 0) return null;
  const byCode = (code) => captionTracks.find((t) => t && t.languageCode === code);
  const startsWithEn = captionTracks.filter((t) => t && typeof t.languageCode === "string" && t.languageCode.startsWith("en"));
  if (startsWithEn.length === 0) return null;
  return (
    byCode("en") ||
    byCode("en-US") ||
    byCode("en-GB") ||
    startsWithEn.find((t) => !t.languageCode.startsWith("a.")) ||
    byCode("a.en") ||
    startsWithEn[0]
  );
}

/**
 * جلب محتوى مسار ترجمة من baseUrl: جرّب json3 أولاً ثم XML.
 */
async function fetchCaptionTrack(baseUrl) {
  const separator = baseUrl.includes("?") ? "&" : "?";
  try {
    const json3Response = await fetchWithTimeout(baseUrl + separator + "fmt=json3", {}, 8000);
    if (json3Response.ok) {
      const json3Text = await json3Response.text();
      try {
        const json3 = JSON.parse(json3Text);
        const cues = parseJson3(json3);
        if (cues.length > 0) return cues;
      } catch (e) {
        // ليس JSON3 صالحاً — نكمل إلى XML
      }
    }
  } catch (e) {
    console.error("[AniDoa] fetch json3 failed:", e && e.message);
  }
  const xmlResponse = await fetchWithTimeout(baseUrl, {}, 8000);
  if (!xmlResponse.ok) {
    throw new Error("فشل جلب مسار الترجمة: HTTP " + xmlResponse.status);
  }
  const xmlText = await xmlResponse.text();
  const trimmed = xmlText.trim();
  if (trimmed.startsWith("{")) {
    try {
      const json3 = JSON.parse(trimmed);
      const cues = parseJson3(json3);
      if (cues.length > 0) return cues;
    } catch (e) {
      // نكمل إلى XML
    }
  }
  if (trimmed.startsWith("WEBVTT")) {
    return parseVTT(trimmed);
  }
  const cues = parseTimedTextXML(xmlText);
  if (cues.length === 0) {
    throw new Error("مسار الترجمة فارغ أو بصيغة غير مدعومة");
  }
  return cues;
}

/**
 * المستوى 1: Innertube — محاولة بعميل واحد (android أو ios).
 */
async function tryInnertubeClient(videoId, clientName) {
  const isAndroid = clientName === "ANDROID";
  const client = isAndroid
    ? {
        clientName: "ANDROID",
        clientVersion: "19.09.37",
        androidSdkVersion: 30,
        hl: "en",
        gl: "US",
      }
    : {
        clientName: "IOS",
        clientVersion: "19.09.3",
        deviceMake: "Apple",
        deviceModel: "iPhone14,3",
        hl: "en",
        gl: "US",
        osName: "iOS",
        osVersion: "17.4.1",
      };
  const userAgent = isAndroid
    ? "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip"
    : "com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 17_4_1 like Mac OS X)";

  const response = await fetchWithTimeout(
    INNERTUBE_PLAYER_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": userAgent,
        Accept: "application/json",
      },
      body: JSON.stringify({
        context: { client },
        videoId,
        playbackContext: { contentPlaybackContext: { vis: 0, splay: false, lact: 0, signatureTimestamp: 0 } },
        racyCheckOk: true,
        contentCheckOk: true,
      }),
    },
    10000
  );
  if (!response.ok) {
    throw new Error("Innertube " + clientName + " HTTP " + response.status);
  }
  const data = await response.json();
  const renderer = data && data.captions && data.captions.playerCaptionsTracklistRenderer;
  if (!renderer || !Array.isArray(renderer.captionTracks) || renderer.captionTracks.length === 0) {
    throw new Error("Innertube " + clientName + ": لا توجد مسارات ترجمة");
  }
  const track = pickEnglishTrack(renderer.captionTracks);
  if (!track || !track.baseUrl) {
    throw new Error("Innertube " + clientName + ": لا يوجد مسار إنجليزي");
  }
  const cues = await fetchCaptionTrack(track.baseUrl);
  if (cues.length === 0) {
    throw new Error("Innertube " + clientName + ": مسار الترجمة فارغ");
  }
  return cues;
}

/**
 * المستوى 1: Innertube — Android ثم iOS.
 */
async function fetchViaInnertube(videoId) {
  try {
    const cues = await tryInnertubeClient(videoId, "ANDROID");
    return { cues, source: "innertube" };
  } catch (androidError) {
    console.error("[AniDoa] Innertube Android failed:", androidError && androidError.message);
  }
  const cues = await tryInnertubeClient(videoId, "IOS");
  return { cues, source: "innertube" };
}

/**
 * المستوى 2أ: Piped — تدوير بين 3 سيرفرات.
 */
async function fetchViaPiped(videoId) {
  let lastError = null;
  for (const server of PIPED_SERVERS) {
    try {
      const response = await fetchWithTimeout(server + "/streams/" + encodeURIComponent(videoId), {}, 8000);
      if (!response.ok) {
        lastError = new Error("Piped " + server + " HTTP " + response.status);
        continue;
      }
      const data = await response.json();
      const subtitles = data && data.subtitles;
      if (!Array.isArray(subtitles) || subtitles.length === 0) {
        lastError = new Error("Piped " + server + ": لا توجد ترجمات");
        continue;
      }
      const enSub =
        subtitles.find((s) => s && (s.code === "en" || s.code === "en-US" || s.code === "en-GB")) ||
        subtitles.find((s) => s && typeof s.code === "string" && s.code.startsWith("en"));
      if (!enSub || !enSub.url) {
        lastError = new Error("Piped " + server + ": لا توجد ترجمة إنجليزية");
        continue;
      }
      const subResponse = await fetchWithTimeout(enSub.url, {}, 8000);
      if (!subResponse.ok) {
        lastError = new Error("Piped subtitle fetch HTTP " + subResponse.status);
        continue;
      }
      const subText = await subResponse.text();
      let cues = [];
      if (subText.trim().startsWith("WEBVTT")) {
        cues = parseVTT(subText);
      } else if (subText.trim().startsWith("{")) {
        try {
          cues = parseJson3(JSON.parse(subText));
        } catch (e) {
          cues = parseSRT(subText);
        }
      } else if (subText.includes("<transcript") || subText.includes("<text")) {
        cues = parseTimedTextXML(subText);
      } else {
        cues = parseSRT(subText);
        if (cues.length === 0) cues = parseVTT(subText);
      }
      if (cues.length === 0) {
        lastError = new Error("Piped " + server + ": ملف الترجمة فارغ");
        continue;
      }
      return { cues, source: "piped" };
    } catch (e) {
      lastError = e;
      console.error("[AniDoa] Piped " + server + " failed:", e && e.message);
    }
  }
  throw lastError || new Error("فشلت كل سيرفرات Piped");
}

/**
 * المستوى 2ب: Invidious — تدوير بين 3 سيرفرات.
 */
async function fetchViaInvidious(videoId) {
  let lastError = null;
  for (const server of INVIDIOUS_SERVERS) {
    try {
      const response = await fetchWithTimeout(server + "/api/v1/videos/" + encodeURIComponent(videoId), {}, 8000);
      if (!response.ok) {
        lastError = new Error("Invidious " + server + " HTTP " + response.status);
        continue;
      }
      const data = await response.json();
      const captions = data && data.captions;
      if (!Array.isArray(captions) || captions.length === 0) {
        lastError = new Error("Invidious " + server + ": لا توجد ترجمات");
        continue;
      }
      const enCap =
        captions.find((c) => c && (c.languageCode === "en" || c.languageCode === "en-US")) ||
        captions.find((c) => c && typeof c.languageCode === "string" && c.languageCode.startsWith("en"));
      if (!enCap || !enCap.url) {
        lastError = new Error("Invidious " + server + ": لا توجد ترجمة إنجليزية");
        continue;
      }
      const captionUrl = enCap.url.startsWith("http") ? enCap.url : server + enCap.url;
      const subResponse = await fetchWithTimeout(captionUrl, {}, 8000);
      if (!subResponse.ok) {
        lastError = new Error("Invidious subtitle fetch HTTP " + subResponse.status);
        continue;
      }
      const subText = await subResponse.text();
      let cues = [];
      if (subText.trim().startsWith("WEBVTT")) {
        cues = parseVTT(subText);
      } else if (subText.includes("<transcript") || subText.includes("<text")) {
        cues = parseTimedTextXML(subText);
      } else if (subText.trim().startsWith("{")) {
        try {
          cues = parseJson3(JSON.parse(subText));
        } catch (e) {
          cues = parseSRT(subText);
        }
      } else {
        cues = parseSRT(subText);
      }
      if (cues.length === 0) {
        lastError = new Error("Invidious " + server + ": ملف الترجمة فارغ");
        continue;
      }
      return { cues, source: "invidious" };
    } catch (e) {
      lastError = e;
      console.error("[AniDoa] Invidious " + server + " failed:", e && e.message);
    }
  }
  throw lastError || new Error("فشلت كل سيرفرات Invidious");
}

/**
 * المستوى 3: Supadata API (يتطلب SUPADATA_API_KEY).
 */
async function fetchViaSupadata(videoId, env) {
  const apiKey = env && env.SUPADATA_API_KEY;
  if (!apiKey) {
    throw new Error("Supadata غير مفعّل — لا يوجد SUPADATA_API_KEY");
  }
  const url =
    "https://api.supadata.ai/v1/youtube/transcript?videoId=" + encodeURIComponent(videoId) + "&lang=en";
  const response = await fetchWithTimeout(
    url,
    { headers: { "x-api-key": apiKey, Accept: "application/json" } },
    15000
  );
  if (!response.ok) {
    throw new Error("Supadata HTTP " + response.status);
  }
  const data = await response.json();
  const items = (data && (data.content || data.transcript || data.data)) || [];
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Supadata: لا يوجد نص مفرّغ");
  }
  const cues = [];
  for (const item of items) {
    if (!item) continue;
    const text = cleanCueText(item.text || "");
    if (!text) continue;
    const offset = Number(item.offset ?? item.start ?? item.startMs ?? 0);
    const duration = Number(item.duration ?? item.dur ?? item.durationMs ?? 0);
    let start = offset;
    let end;
    if (typeof item.startMs === "number") start = item.startMs / 1000;
    if (typeof item.durationMs === "number") {
      end = start + item.durationMs / 1000;
    } else if (duration > 0) {
      end = start + (duration > 1000 ? duration / 1000 : duration);
    } else {
      end = start + 2;
    }
    if (end <= start) end = start + 2;
    cues.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, text });
  }
  const cleaned = dedupeAndSortCues(cues);
  if (cleaned.length === 0) {
    throw new Error("Supadata: النص المفرّغ فارغ بعد التنظيف");
  }
  return { cues: cleaned, source: "supadata" };
}

/**
 * الدالة الرئيسية: سحب الترجمة الإنجليزية مع Fallback متدرج.
 * لا تتوقف أبداً بخطأ شبكة عابر — تجرّب كل المستويات ثم ترمي NoSubtitlesError.
 */
export async function getEnglishSubtitles(videoId, env) {
  if (!videoId || typeof videoId !== "string") {
    throw new NoSubtitlesError("معرّف الفيديو غير صالح");
  }

  try {
    const result = await fetchViaInnertube(videoId);
    console.log("[AniDoa] Subtitles via innertube, cues=" + result.cues.length);
    return result;
  } catch (e) {
    console.error("[AniDoa] Level 1 Innertube failed:", e && e.message);
  }

  try {
    const result = await fetchViaPiped(videoId);
    console.log("[AniDoa] Subtitles via piped, cues=" + result.cues.length);
    return result;
  } catch (e) {
    console.error("[AniDoa] Level 2 Piped failed:", e && e.message);
  }

  try {
    const result = await fetchViaInvidious(videoId);
    console.log("[AniDoa] Subtitles via invidious, cues=" + result.cues.length);
    return result;
  } catch (e) {
    console.error("[AniDoa] Level 2 Invidious failed:", e && e.message);
  }

  try {
    const result = await fetchViaSupadata(videoId, env);
    console.log("[AniDoa] Subtitles via supadata, cues=" + result.cues.length);
    return result;
  } catch (e) {
    console.error("[AniDoa] Level 3 Supadata failed:", e && e.message);
  }

  throw new NoSubtitlesError(
    "تعذّر العثور على ترجمة إنجليزية لهذه الحلقة. قد تكون الحلقة بدون ترجمة (Hardsub) أو حظر يوتيوب كل السيرفرات مؤقتاً."
  );
}
