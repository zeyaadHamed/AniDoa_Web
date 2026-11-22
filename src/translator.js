/**
 * AniDoa — translator.js
 * محرك الترجمة الذكي عبر Google Gemini 3.5 Flash-Lite.
 * (تمت الترقية من gemini-2.5-flash إلى gemini-3.5-flash-lite — نموذج تصفه
 * Google بأنه مناسب للترجمة ومعالجة النصوص بكميات كبيرة.)
 *
 * - تقسيم الترجمة إلى دفعات (Chunks) كل دفعة 50 سطراً
 * - Context Overlap: آخر سطرين من الدفعة السابقة كسياق فقط
 * - حل مشكلة تقطيع الجمل عبر توزيع المعنى الكامل على نفس التوقيتات
 * - قاموس مصطلحات دونغهوا صارم
 * - مخرجات JSON نظيفة فقط مع تحقق وإعادة محاولة
 * - إعادة محاولة تلقائية مع Exponential Backoff عند أخطاء Gemini المؤقتة
 *
 * ملاحظة نماذج Gemini 3.5: معاملات العيّنة (temperature / topP / topK)
 * أصبحت مهملة (deprecated) ويجب عدم إرسالها — انظر getGenerationConfig().
 */

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

/**
 * النموذج النشط: متغير GEMINI_MODEL من Dashboard إن وُجد، وإلا الافتراضي.
 */
export function getActiveModel(env) {
  const override = env && typeof env.GEMINI_MODEL === "string" ? env.GEMINI_MODEL.trim() : "";
  return override || DEFAULT_GEMINI_MODEL;
}

const CHUNK_SIZE = 50;
const CONTEXT_OVERLAP = 2;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_GEMINI_ATTEMPTS = 4;

export const DONGHUA_GLOSSARY = {
  Qi: "تشي",
  Cultivation: "صقل",
  Sect: "طائفة",
  Realm: "عالم/مستوى",
  Elder: "شيخ",
  Disciple: "تلميذ",
  "Core Formation": "تكوين النواة",
  "Nascent Soul": "الروح الوليدة",
  "Spirit Stone": "حجر روحي",
  Technique: "تقنية",
  Master: "معلم",
  Martial: "قتالي",
  "Golden Core": "النواة الذهبية",
  "Foundation Establishment": "تأسيس الأساس",
  "Divine Sense": "الإحساس الإلهي",
  "Spiritual Energy": "الطاقة الروحية",
  "Inner Disciple": "تلميذ داخلي",
  "Outer Disciple": "تلميذ خارجي",
  "Sect Master": "زعيم الطائفة",
  "Grand Elder": "الشيخ الأكبر",
};

/**
 * إعدادات التوليد لنماذج Gemini 3.5.
 * تحتوي على maxOutputTokens و responseMimeType فقط — معاملات العيّنة
 * (temperature / topP / topK) مهملة في نماذج Gemini 3.5 ولا تُرسل أبداً.
 */
export function getGenerationConfig() {
  return {
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
  };
}

/**
 * حساب تأخير إعادة المحاولة (Exponential Backoff + Jitter).
 * attempt: عدد المحاولات السابقة (0 عند أول إعادة محاولة).
 * retryAfterHeader: قيمة ترويسة Retry-After بالثواني إن أرسلها السيرفر —
 * تُحترم بحد أقصى 30 ثانية. بدونها: 2000/5000/10000ms مضروبة في Jitter 0.5–1.5.
 */
export function computeRetryDelay(attempt, retryAfterHeader) {
  if (retryAfterHeader !== null && retryAfterHeader !== undefined && retryAfterHeader !== "") {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(Math.floor(seconds * 1000), 30000);
    }
  }
  const a = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const bases = [2000, 5000, 10000];
  const base = bases[Math.min(a, bases.length - 1)];
  const jitter = 0.5 + Math.random();
  return Math.round(base * jitter);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * تقسيم الأسطر إلى دفعات مع سياق متداخل.
 * يُرجع مصفوفة من {chunk, context} حيث context هي آخر `overlap` سطراً من
 * الدفعة السابقة (تُعرض على النموذج كسياق فقط — غير مشمولة في حمولة الدفعة).
 */
export function chunkCues(cues, size, overlap) {
  const chunkSize = size || CHUNK_SIZE;
  const overlapSize = overlap === undefined || overlap === null ? CONTEXT_OVERLAP : overlap;
  const result = [];
  let previousTail = [];
  for (let offset = 0; offset < cues.length; offset += chunkSize) {
    const chunk = cues.slice(offset, offset + chunkSize);
    result.push({ chunk, context: previousTail });
    previousTail = overlapSize > 0 ? chunk.slice(-overlapSize) : [];
  }
  return result;
}

/**
 * استخراج JSON نظيف من رد Gemini (إزالة ```json fences والبحث عن أول [ وآخر ]).
 */
export function cleanGeminiJson(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("رد Gemini فارغ");
  }
  let text = raw.trim();
  text = text.replace(/^```(?:json|JSON)?\s*/m, "");
  text = text.replace(/\s*```$/m, "");
  text = text.trim();
  const startIndex = text.indexOf("[");
  const endIndex = text.lastIndexOf("]");
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error("لم يتم العثور على مصفوفة JSON في رد Gemini");
  }
  const jsonSlice = text.slice(startIndex, endIndex + 1);
  let parsed;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch (e) {
    const repaired = jsonSlice
      .replace(/,\s*]/g, "]")
      .replace(/,\s*}/g, "}");
    parsed = JSON.parse(repaired);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("مخرجات Gemini ليست مصفوفة JSON");
  }
  return parsed;
}

/**
 * بناء الـ Prompt الصارم لدفعة واحدة مع سياق اختياري.
 */
export function buildPrompt(chunk, contextCues) {
  const context = Array.isArray(contextCues) ? contextCues : [];
  const chunkLines = chunk
    .map((cue, i) => "[" + i + "] (" + cue.start + "s --> " + cue.end + "s) " + cue.text)
    .join("\n");
  const contextLines =
    context.length > 0
      ? context.map((cue) => "(" + cue.start + "s --> " + cue.end + "s) " + cue.text).join("\n")
      : "لا يوجد سياق سابق.";

  return (
    "أنت مترجم محترف متخصص في ترجمة مسلسلات الدونغهوا (الأنمي الصيني) من الإنجليزية إلى العربية الفصحى السلسة.\n" +
    "\n" +
    "تعليمات صارمة يجب الالتزام بها حرفياً:\n" +
    "\n" +
    "1) اقرأ الدفعة كاملة أولاً كحوار متصل قبل أن تبدأ الترجمة، وافهم المعنى العام والسياق الدرامي.\n" +
    "\n" +
    "2) حل مشكلة تقطيع الجمل: إذا كانت الجملة الإنجليزية مقسومة على توقيتين متتاليين أو أكثر، ترجم المعنى الكامل " +
    "بالعربية الفصحى السلسة أولاً في ذهنك، ثم وزّع الكلمات العربية بشكل منطقي ومريح للقراءة على نفس التوقيتات " +
    "دون تغيير أرقام الـ Timestamps أبداً. لا تترجم كل سطر بمعزل عن الآخر، ولا تترك جملة عربية مبتورة بلا معنى.\n" +
    "\n" +
    "3) قاموس مصطلحات الدونغهوا — التزم به بدقة ولا تترجم هذه الكلمات بأي بديل آخر:\n" +
    "   Qi = تشي | Cultivation = صقل | Sect = طائفة | Realm = عالم/مستوى | Elder = شيخ | Disciple = تلميذ\n" +
    "   Core Formation = تكوين النواة | Nascent Soul = الروح الوليدة | Spirit Stone = حجر روحي\n" +
    "   Technique = تقنية | Master = معلم | Martial = قتالي | Golden Core = النواة الذهبية\n" +
    "   Foundation Establishment = تأسيس الأساس | Divine Sense = الإحساس الإلهي\n" +
    "   Spiritual Energy = الطاقة الروحية | Inner Disciple = تلميذ داخلي | Outer Disciple = تلميذ خارجي\n" +
    "   Sect Master = زعيم الطائفة | Grand Elder = الشيخ الأكبر\n" +
    "\n" +
    "4) أسماء الشخصيات والأماكن: انقلها صوتياً بالعربية (Transliteration) وحافظ على نفس الكتابة في كل الدفعة.\n" +
    "   لا تترك أي كلمة إنجليزية في النص المترجم إلا أسماء الأعلام عند الضرورة القصوى.\n" +
    "\n" +
    "5) استخدم العربية الفصحى السلسة الطبيعية المناسبة للمشاهدة، وتجنب الترجمة الحرفية الجافة.\n" +
    "   حافظ على نبرة الحوار (رسمي/ودي/غاضب) كما في الأصل.\n" +
    "\n" +
    "6) صيغة المخرجات: أرجع مصفوفة JSON نظيفة فقط، بدون أي نص خارجها وبدون شرح، بهذا الشكل:\n" +
    '   [{"start": 12.5, "end": 15.2, "text": "..."}]\n' +
    "   - يجب أن يكون عدد العناصر مساوياً تماماً لعدد أسطر الدفعة (بدون أسطر السياق).\n" +
    "   - يجب أن تكون قيم start و end مطابقة تماماً للأرقام الأصلية بدون أي تغيير.\n" +
    "   - حقل text يحتوي الترجمة العربية فقط.\n" +
    "\n" +
    "=== سياق فقط — لا تترجمه ولا تضعه في المخرجات ===\n" +
    contextLines +
    "\n" +
    "=== الدفعة المطلوب ترجمتها (" +
    chunk.length +
    " سطراً) ===\n" +
    chunkLines +
    "\n" +
    "\nأرجع مصفوفة JSON فقط."
  );
}

/**
 * استدعاء Gemini مع مهلة 30 ثانية لكل محاولة وإعادة محاولة تلقائية
 * (حتى 4 محاولات إجمالاً: المحاولة الأولى + 3 إعادات) عند أخطاء
 * 429/500/502/503 أو أخطاء الشبكة، مع Exponential Backoff واحترام
 * ترويسة Retry-After. أخطاء 400/401/403 غير قابلة لإعادة المحاولة.
 */
async function callGemini(prompt, apiKey, model) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model || DEFAULT_GEMINI_MODEL) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: getGenerationConfig(),
  };

  async function doRequest() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  const RETRYABLE_STATUSES = [429, 500, 502, 503];
  let lastError = null;
  for (let attempt = 0; attempt < MAX_GEMINI_ATTEMPTS; attempt++) {
    let response = null;
    try {
      response = await doRequest();
    } catch (e) {
      lastError = e;
      if (attempt < MAX_GEMINI_ATTEMPTS - 1) {
        const delay = computeRetryDelay(attempt, null);
        console.error(
          "[AniDoa] Gemini network error (attempt " +
            (attempt + 1) +
            "/" +
            MAX_GEMINI_ATTEMPTS +
            "), retrying after " +
            delay +
            "ms: " +
            (e && e.message)
        );
        await sleep(delay);
        continue;
      }
      throw new Error("تعذّر الوصول إلى Gemini بعد عدة محاولات. تحقق من الاتصال وحاول مرة أخرى.");
    }
    if (response.ok) {
      const data = await response.json();
      const candidates = data && data.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error("لم يُرجع Gemini أي نتيجة ترجمة.");
      }
      const parts = candidates[0] && candidates[0].content && candidates[0].content.parts;
      if (!Array.isArray(parts) || parts.length === 0 || typeof parts[0].text !== "string") {
        throw new Error("رد Gemini بلا نص ترجمة.");
      }
      return parts[0].text;
    }
    if (RETRYABLE_STATUSES.indexOf(response.status) !== -1 && attempt < MAX_GEMINI_ATTEMPTS - 1) {
      const retryAfter = response.headers.get("Retry-After");
      const delay = computeRetryDelay(attempt, retryAfter);
      console.error(
        "[AniDoa] Gemini HTTP " +
          response.status +
          " (attempt " +
          (attempt + 1) +
          "/" +
          MAX_GEMINI_ATTEMPTS +
          "), retrying after " +
          delay +
          "ms"
      );
      await sleep(delay);
      continue;
    }
    const errorText = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new Error("تجاوزت حد طلبات Gemini مؤقتاً (Rate Limit). حاول مرة أخرى بعد قليل.");
    }
    if (response.status === 400) {
      throw new Error("طلب ترجمة غير صالح (Gemini 400). تحقق من مفتاح GEMINI_API_KEY.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("مفتاح Gemini غير صالح أو بلا صلاحية. تحقق من GEMINI_API_KEY.");
    }
    throw new Error("فشلت الترجمة عبر Gemini (HTTP " + response.status + "). " + errorText.slice(0, 200));
  }
  throw lastError || new Error("فشلت الترجمة عبر Gemini بعد عدة محاولات.");
}

/**
 * التحقق من مخرجات الترجمة: نفس العدد ونفس التوقيتات.
 */
function validateTranslatedChunk(translated, originalChunk) {
  if (!Array.isArray(translated)) return false;
  if (translated.length !== originalChunk.length) return false;
  for (let i = 0; i < translated.length; i++) {
    const item = translated[i];
    const orig = originalChunk[i];
    if (!item || typeof item.text !== "string" || !item.text.trim()) return false;
    if (Number(item.start) !== Number(orig.start) || Number(item.end) !== Number(orig.end)) return false;
  }
  return true;
}

/**
 * تطبيع مخرجات الترجمة: فرض التوقيتات الأصلية وتنظيف النص.
 */
function normalizeTranslatedChunk(translated, originalChunk) {
  return originalChunk.map((orig, i) => {
    const item = translated[i] || {};
    return {
      start: Number(orig.start),
      end: Number(orig.end),
      text: String(item.text || orig.text || "").trim(),
    };
  });
}

/**
 * ترجمة دفعة واحدة مع إعادة محاولة الإصلاح عند عدم تطابق العدد.
 */
async function translateOneChunk(chunk, contextCues, apiKey, model) {
  const prompt = buildPrompt(chunk, contextCues);
  const raw = await callGemini(prompt, apiKey, model);
  let parsed = cleanGeminiJson(raw);
  if (validateTranslatedChunk(parsed, chunk)) {
    return normalizeTranslatedChunk(parsed, chunk);
  }
  console.error(
    "[AniDoa] Chunk length mismatch: expected " + chunk.length + ", got " + parsed.length + " — repair retry"
  );
  const repairPrompt =
    "الترجمة السابقة كان عدد أسطرها غير صحيح. أعد الترجمة الآن والتزم تماماً: عدد العناصر يجب أن يساوي " +
    chunk.length +
    " عنصراً بالضبط، وبنفس قيم start و end الأصلية، وأرجع مصفوفة JSON فقط بدون أي نص آخر.\n\n" +
    prompt;
  const repairRaw = await callGemini(repairPrompt, apiKey, model);
  parsed = cleanGeminiJson(repairRaw);
  if (validateTranslatedChunk(parsed, chunk)) {
    return normalizeTranslatedChunk(parsed, chunk);
  }
  throw new Error(
    "تعذّرت ترجمة دفعة من الترجمة (عدد الأسطر غير مطابق: متوقع " +
      chunk.length +
      "، وصل " +
      parsed.length +
      ")."
  );
}

/**
 * ترجمة دفعة صغيرة (10 أسطر) كخطة احتياطية عند فشل الدفعة الكبيرة.
 */
async function translateSmallBatch(chunk, apiKey, model) {
  const prompt = buildPrompt(chunk, []);
  const raw = await callGemini(prompt, apiKey, model);
  const parsed = cleanGeminiJson(raw);
  if (!validateTranslatedChunk(parsed, chunk)) {
    throw new Error("فشلت ترجمة الدفعة الصغيرة أيضاً.");
  }
  return normalizeTranslatedChunk(parsed, chunk);
}

/**
 * الدالة الرئيسية: ترجمة مصفوفة cues كاملة إلى العربية.
 * دفعات متسلسلة للحفاظ على السياق، مع Context Overlap سطرين.
 */
export async function translateSubtitles(cues, env) {
  const apiKey = env && env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("مفتاح Gemini غير مضبوط. أضف GEMINI_API_KEY من لوحة تحكم Cloudflare.");
  }
  if (!Array.isArray(cues) || cues.length === 0) {
    throw new Error("لا توجد أسطر ترجمة لترجمتها.");
  }

  const model = getActiveModel(env);
  const allTranslated = [];
  const chunks = chunkCues(cues, CHUNK_SIZE, CONTEXT_OVERLAP);

  for (const { chunk, context } of chunks) {
    try {
      const translated = await translateOneChunk(chunk, context, apiKey, model);
      allTranslated.push(...translated);
    } catch (chunkError) {
      console.error("[AniDoa] Chunk failed, falling back to batches of 10:", chunkError && chunkError.message);
      for (let smallOffset = 0; smallOffset < chunk.length; smallOffset += 10) {
        const smallBatch = chunk.slice(smallOffset, smallOffset + 10);
        const smallTranslated = await translateSmallBatch(smallBatch, apiKey, model);
        allTranslated.push(...smallTranslated);
      }
    }
  }

  if (allTranslated.length !== cues.length) {
    throw new Error("عدد الأسطر المترجمة غير مطابق للأصل بعد الترجمة.");
  }
  return allTranslated;
}
