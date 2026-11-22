/**
 * AniDoa — security.js
 * أدوات أمان نقية (Pure Helpers) قابلة للاختبار بدون Cloudflare Workers.
 *
 * تشمل: ترويسات الأمان، التحقق من صيغ المعرّفات، استخراج playlistId،
 * مقارنة مقاومة للتوقيت، استخراج IP العميل، وأدوات حدود الطلبات (Rate Limit).
 */

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://i.ytimg.com https://yt3.ggpht.com",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * ترويسات الأمان المطبقة على كل رد من الـ Worker.
 */
export function securityHeaders() {
  return {
    "Content-Security-Policy": CSP_DIRECTIVES,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  };
}

/**
 * إرجاع نسخة جديدة من Response مع دمج ترويسات الأمان.
 * ترويسات الرد الأصلية (مثل Content-Type) تُحفظ، و `extra` تتجاوز الكل عند التعارض.
 */
export function withSecurityHeaders(response, extra) {
  const headers = new Headers(securityHeaders());
  if (response && response.headers) {
    response.headers.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  if (extra) {
    for (const key of Object.keys(extra)) {
      headers.set(key, extra[key]);
    }
  }
  return new Response(response ? response.body : null, {
    status: response ? response.status : 200,
    statusText: response ? response.statusText : "",
    headers,
  });
}

/**
 * استخراج playlistId من رابط كامل أو معرّف خام.
 * يقبل: youtube.com/playlist?list=... و watch?v=..&list=.. و youtu.be/..?list=.. ومعرّفاً خاماً.
 */
export function extractPlaylistId(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const listMatch = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (listMatch) return listMatch[1];
  if (isValidPlaylistId(trimmed)) return trimmed;
  return null;
}

/**
 * معرّف فيديو يوتيوب صالح: 11 حرفاً بالضبط من [A-Za-z0-9_-].
 */
export function isValidVideoId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id);
}

/**
 * معرّف قائمة تشغيل صالح: 10 إلى 64 حرفاً من [A-Za-z0-9_-].
 */
export function isValidPlaylistId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{10,64}$/.test(id);
}

/**
 * مقارنة سلاسل مقاومة لتسريب التوقيت (Constant-Time).
 * تمر على أقصى طول للسلسلتين دائماً حتى عند اختلاف الطولين، حتى لا يكشف
 * زمن المقارنة عن طول كلمة السر الصحيحة.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < maxLen; i++) {
    const ac = i < a.length ? a.charCodeAt(i) : 0;
    const bc = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ac ^ bc;
  }
  return diff === 0;
}

/**
 * استخراج IP العميل الحقيقي خلف Cloudflare:
 * CF-Connecting-IP أولاً، ثم أول إدخال في X-Forwarded-For، ثم "unknown".
 */
export function getClientIp(request) {
  if (!request || !request.headers || typeof request.headers.get !== "function") {
    return "unknown";
  }
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp && cfIp.trim()) return cfIp.trim();
  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded && forwarded.trim()) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return "unknown";
}

/**
 * سلة الساعة الحالية بصيغة UTC: "YYYY-MM-DDTHH" (مثال: "2026-11-23T01").
 */
export function hourBucket(date) {
  const d = date instanceof Date ? date : new Date(date === undefined ? Date.now() : date);
  return d.toISOString().slice(0, 13);
}

/**
 * سلة اليوم الحالي بصيغة UTC: "YYYY-MM-DD" (مثال: "2026-11-23").
 */
export function dayBucket(date) {
  const d = date instanceof Date ? date : new Date(date === undefined ? Date.now() : date);
  return d.toISOString().slice(0, 10);
}

/**
 * بناء مفتاح عدّاد حدود الطلبات في KV: "prefix:id:bucket".
 */
export function rateLimitKey(prefix, id, bucket) {
  return prefix + ":" + id + ":" + bucket;
}
