/**
 * AniDoa — translator.js
 * محرك الترجمة الذكي عبر Google Gemini 2.5 Flash.
 *
 * - تقسيم الترجمة إلى دفعات (Chunks) كل دفعة 50 سطراً
 * - Context Overlap: آخر سطرين من الدفعة السابقة كسياق فقط
 * - حل مشكلة تقطيع الجمل عبر توزيع المعنى الكامل على نفس التوقيتات
 * - قاموس مصطلحات دونغهوا صارم
 * - مخرجات JSON نظيفة فقط مع تحقق وإعادة محاولة
 */

const GEMINI_MODEL = "gemini-2.5-flash";
const CHUNK_SIZE = 50;
const CONTEXT_OVERLAP = 2;
const REQUEST_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 5000;

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
 * استدعاء Gemini مع مهلة و إعادة محاولة واحدة عند 429.
 */
async function callGemini(prompt, apiKey) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    GEMINI_MODEL +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
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

  let response = await doRequest();
  if (response.status === 429) {
    console.error("[AniDoa] Gemini 429 — retrying after 5s");
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await doRequest();
  }
  if (!response.ok) {
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
async function translateOneChunk(chunk, contextCues, apiKey) {
  const prompt = buildPrompt(chunk, contextCues);
  const raw = await callGemini(prompt, apiKey);
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
  const repairRaw = await callGemini(repairPrompt, apiKey);
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
async function translateSmallBatch(chunk, apiKey) {
  const prompt = buildPrompt(chunk, []);
  const raw = await callGemini(prompt, apiKey);
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

  const allTranslated = [];
  let previousChunkTail = [];

  for (let offset = 0; offset < cues.length; offset += CHUNK_SIZE) {
    const chunk = cues.slice(offset, offset + CHUNK_SIZE);
    const contextCues = previousChunkTail;
    try {
      const translated = await translateOneChunk(chunk, contextCues, apiKey);
      allTranslated.push(...translated);
    } catch (chunkError) {
      console.error("[AniDoa] Chunk failed, falling back to batches of 10:", chunkError && chunkError.message);
      for (let smallOffset = 0; smallOffset < chunk.length; smallOffset += 10) {
        const smallBatch = chunk.slice(smallOffset, smallOffset + 10);
        const smallTranslated = await translateSmallBatch(smallBatch, apiKey);
        allTranslated.push(...smallTranslated);
      }
    }
    previousChunkTail = chunk.slice(-CONTEXT_OVERLAP);
  }

  if (allTranslated.length !== cues.length) {
    throw new Error("عدد الأسطر المترجمة غير مطابق للأصل بعد الترجمة.");
  }
  return allTranslated;
}
