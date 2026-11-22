/**
 * AniDoa — cues.js
 * دوال نقية للتعامل مع أسطر الترجمة (Cues) في المشغل.
 *
 * مهم جداً: كل دالة هنا مكتفية ذاتياً (self-contained) — لا تستدعي أي دالة
 * أو ثابت خارجي من هذا الملف أو غيره، لأن ui.js يضمّنها داخل سكربت المشغل
 * في المتصفح عبر .toString(). أي اعتماد خارجي سيكسر المشغل.
 *
 * تفترض الدوال أن الأسطر مرتبة حسب start وغير متداخلة (وهو ما يضمنه
 * dedupeAndSortCues في subtitles.js ومخرجات المترجم).
 */

/**
 * إيجاد السطر النشط عند لحظة زمنية معينة.
 * - مسار سريع O(1) amortized للتشغيل المتسلسل: يفحص lastIndex وجيرانه أولاً.
 * - وإلا بحث ثنائي (Binary Search) على الأسطر المرتبة حسب start.
 * - الحدود: start شاملة و end غير شاملة (السطر نشط عندما start <= t < end).
 * - يُرجع {index, cue} أو {index:-1, cue:null} عند عدم وجود سطر نشط
 *   (قبل أول سطر، أو في فجوة بين سطرين، أو بعد آخر سطر).
 */
export function findActiveCue(cues, timeSeconds, lastIndex) {
  if (!Array.isArray(cues) || cues.length === 0) {
    return { index: -1, cue: null };
  }
  const t = Number(timeSeconds);
  if (Number.isNaN(t)) {
    return { index: -1, cue: null };
  }
  const n = cues.length;
  const li = typeof lastIndex === "number" ? lastIndex : -1;

  function contains(i) {
    if (i < 0 || i >= n) return false;
    const c = cues[i];
    return t >= c.start && t < c.end;
  }

  // المسار السريع: التشغيل المتسلسل — السطر الحالي أو جيرانه المباشرون.
  if (li >= 0 && li < n) {
    if (contains(li)) return { index: li, cue: cues[li] };
    if (contains(li + 1)) return { index: li + 1, cue: cues[li + 1] };
    if (contains(li - 1)) return { index: li - 1, cue: cues[li - 1] };
  }

  // البحث الثنائي: آخر سطر تبدأ بدايته عند أو قبل t.
  let lo = 0;
  let hi = n - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (candidate === -1) {
    return { index: -1, cue: null };
  }
  if (t < cues[candidate].end) {
    return { index: candidate, cue: cues[candidate] };
  }
  return { index: -1, cue: null };
}

/**
 * تحويل الأسطر إلى نص SRT صالح للتحميل.
 * التوقيت بصيغة HH:MM:SS,mmm.
 */
export function cuesToSrt(cues) {
  function formatTimestamp(seconds) {
    const totalMs = Math.max(0, Math.round(Number(seconds) * 1000));
    const ms = totalMs % 1000;
    const totalSeconds = Math.floor(totalMs / 1000);
    const s = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const m = totalMinutes % 60;
    const h = Math.floor(totalMinutes / 60);
    function pad2(n) {
      return n < 10 ? "0" + n : "" + n;
    }
    function pad3(n) {
      if (n < 10) return "00" + n;
      if (n < 100) return "0" + n;
      return "" + n;
    }
    return pad2(h) + ":" + pad2(m) + ":" + pad2(s) + "," + pad3(ms);
  }

  if (!Array.isArray(cues) || cues.length === 0) return "";
  const blocks = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    blocks.push(
      i + 1 + "\n" + formatTimestamp(cue.start) + " --> " + formatTimestamp(cue.end) + "\n" + String(cue.text || "").trim()
    );
  }
  return blocks.join("\n\n") + "\n";
}

/**
 * نسخة مرتبة من الأسطر حسب start (دون تعديل المصفوفة الأصلية).
 */
export function sortCues(cues) {
  if (!Array.isArray(cues)) return [];
  return cues.slice().sort((a, b) => Number(a.start) - Number(b.start));
}
