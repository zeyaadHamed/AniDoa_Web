/**
 * AniDoa — src/ui.js
 * كل واجهات المنصة: HTML + CSS + JavaScript المضمّن.
 * Mobile-First Dark Mode، RTL، خط Cairo.
 * الألوان: خلفية #0B0F19، كروت #151C2C، أساسي #10B981، ثانوي #F59E0B.
 */

import { findActiveCue, cuesToSrt, sortCues } from "./cues.js";

export function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeJsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/**
 * شعار AniDoa: مثلث تشغيل مدمج مع هالة طاقة (Qi) — SVG مضمّن.
 */
export function logoSVG(size) {
  const s = size || 40;
  return (
    '<svg width="' + s + '" height="' + s + '" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="AniDoa logo">' +
    '<defs><linearGradient id="qiGrad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="#10B981"/><stop offset="1" stop-color="#F59E0B"/></linearGradient></defs>' +
    '<circle cx="32" cy="32" r="28" stroke="url(#qiGrad)" stroke-width="3" opacity="0.95"/>' +
    '<circle cx="32" cy="32" r="22" stroke="#10B981" stroke-width="1.5" stroke-dasharray="4 5" opacity="0.55"/>' +
    '<circle cx="50" cy="14" r="3.2" fill="#F59E0B"/>' +
    '<circle cx="14" cy="48" r="2.4" fill="#10B981"/>' +
    '<path d="M27 21.5v21c0 1.6 1.7 2.6 3.1 1.8l16.5-10.5c1.3-.8 1.3-2.7 0-3.6L30.1 19.7c-1.4-.8-3.1.2-3.1 1.8z" fill="#10B981"/>' +
    "</svg>"
  );
}

const BASE_CSS = `
*{box-sizing:border-box}
:root{--bg:#0B0F19;--card:#151C2C;--card2:#1B2438;--primary:#10B981;--secondary:#F59E0B;--text:#F1F5F9;--muted:#94A3B8;--border:#24304A;--danger:#EF4444}
html{direction:rtl}
body{margin:0;font-family:'Cairo',system-ui,-apple-system,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.7}
a{color:inherit;text-decoration:none}
button{font-family:inherit;cursor:pointer}
input,textarea,select{font-family:inherit}
.container{max-width:1180px;margin:0 auto;padding:0 16px 48px}
header.site{position:sticky;top:0;z-index:50;background:rgba(11,15,25,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.header-inner{max-width:1180px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:12px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:22px;letter-spacing:.2px}
.brand small{display:block;font-size:12px;color:var(--muted);font-weight:600;line-height:1.2}
.brand .logo-text{line-height:1.1}
.brand .logo-text em{font-style:normal;color:var(--primary)}
.nav{margin-inline-start:auto;display:flex;gap:8px;align-items:center}
.nav a{padding:8px 14px;border-radius:999px;background:var(--card);border:1px solid var(--border);font-weight:700;font-size:14px}
.nav a:hover{border-color:var(--primary)}
h1{font-size:26px;margin:22px 0 6px}
h2{font-size:20px;margin:24px 0 12px}
.subtitle{color:var(--muted);margin:0 0 18px;font-size:15px}
.searchbar{display:flex;gap:10px;margin:16px 0 20px}
.searchbar input{flex:1;background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:12px;padding:12px 14px;font-size:16px;outline:none}
.searchbar input:focus{border-color:var(--primary)}
.btn{border:none;border-radius:12px;padding:12px 18px;font-weight:800;font-size:15px;background:var(--primary);color:#04150E;transition:transform .08s ease,filter .15s}
.btn:hover{filter:brightness(1.08)}
.btn:active{transform:scale(.98)}
.btn.secondary{background:var(--secondary);color:#221503}
.btn.ghost{background:var(--card);color:var(--text);border:1px solid var(--border)}
.btn.danger{background:transparent;color:#FCA5A5;border:1px solid #7F1D1D}
.btn.small{padding:8px 12px;font-size:13px;border-radius:10px}
.btn:disabled{opacity:.6;cursor:not-allowed}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
@media(min-width:700px){.grid{grid-template-columns:repeat(3,1fr)}}
@media(min-width:1020px){.grid{grid-template-columns:repeat(4,1fr)}}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;transition:transform .15s,border-color .15s;position:relative}
.card:hover{transform:translateY(-3px);border-color:var(--primary)}
.card img.thumb{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#0F172A}
.card-body{padding:12px}
.card-title{font-weight:800;font-size:15px;line-height:1.5;min-height:48px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-meta{color:var(--muted);font-size:13px;margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.badge{display:inline-block;background:rgba(245,158,11,.16);color:var(--secondary);border:1px solid rgba(245,158,11,.45);padding:2px 8px;border-radius:999px;font-size:12px;font-weight:800}
.badge.green{background:rgba(16,185,129,.14);color:#34D399;border-color:rgba(16,185,129,.45)}
.card-actions{display:flex;gap:8px;margin-top:10px}
.card-actions .btn{flex:1}
.empty{background:var(--card);border:1px dashed var(--border);border-radius:16px;padding:36px 20px;text-align:center;color:var(--muted)}
.empty b{color:var(--text);font-size:18px;display:block;margin-bottom:6px}
.panel{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:16px;margin-top:18px}
.panel h2{margin-top:0}
.field{margin-bottom:12px}
.field label{display:block;font-weight:700;font-size:14px;margin-bottom:6px}
.field input,.field textarea{width:100%;background:#0B0F19;border:1px solid var(--border);color:var(--text);border-radius:12px;padding:11px 13px;font-size:15px;outline:none}
.field input:focus,.field textarea:focus{border-color:var(--primary)}
.field textarea{min-height:120px;resize:vertical}
.field .hint{color:var(--muted);font-size:13px;margin-top:5px}
.alert{border-radius:12px;padding:12px 14px;font-weight:700;font-size:14px;margin:12px 0;display:none}
.alert.show{display:block}
.alert.error{background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.5);color:#FCA5A5}
.alert.success{background:rgba(16,185,129,.14);border:1px solid rgba(16,185,129,.5);color:#6EE7B7}
.alert.info{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.45);color:#FCD34D}
.spinner{width:22px;height:22px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;display:inline-block;animation:spin .8s linear infinite;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
.skeleton{border-radius:16px;background:linear-gradient(90deg,#151C2C 25%,#1B2438 50%,#151C2C 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;min-height:210px}
@keyframes shimmer{to{background-position:-200% 0}}
footer{border-top:1px solid var(--border);color:var(--muted);text-align:center;padding:22px 16px;font-size:13px}
.watch-title{font-size:20px;margin:18px 0 4px}
.watch-sub{color:var(--muted);font-size:14px;margin:0 0 12px}
.player-wrap{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:16px;overflow:hidden;border:1px solid var(--border)}
.player-wrap iframe,.player-wrap #yt-player{position:absolute;inset:0;width:100%;height:100%;border:0}
.subtitle-overlay{position:absolute;left:0;right:0;bottom:9%;text-align:center;pointer-events:none;padding:0 8%;z-index:5;display:flex;justify-content:center}
.subtitle-overlay span{display:inline-block;font-weight:800;line-height:1.9;border-radius:8px;padding:2px 12px;max-width:100%;word-break:break-word}
.controls{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:14px;margin-top:14px}
.controls-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
.controls-row:last-child{margin-bottom:0}
.controls-label{font-weight:800;font-size:13px;color:var(--muted);min-width:92px}
.chip{border:1px solid var(--border);background:#0B0F19;color:var(--text);border-radius:999px;padding:7px 12px;font-weight:800;font-size:13px}
.chip.active{background:var(--primary);color:#04150E;border-color:var(--primary)}
.chip:hover{border-color:var(--primary)}
input[type=range]{accent-color:var(--primary)}
.sync-value{font-weight:800;color:var(--secondary);min-width:64px;text-align:center}
.ep-nav{display:flex;gap:10px;margin-top:14px}
.ep-nav .btn{flex:1}
.episodes{margin-top:18px}
.ep-list{display:grid;gap:10px}
@media(min-width:760px){.ep-list{grid-template-columns:1fr 1fr}}
.ep-item{display:flex;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:10px;align-items:center;text-align:start;width:100%;color:var(--text)}
.ep-item:hover{border-color:var(--primary)}
.ep-item.current{border-color:var(--primary);background:#12241D}
.ep-item img{width:120px;aspect-ratio:16/9;object-fit:cover;border-radius:10px;flex-shrink:0;background:#0F172A}
.ep-item .ep-num{font-size:12px;color:var(--secondary);font-weight:800}
.ep-item .ep-title{font-weight:700;font-size:14px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.resume-bar{display:none;background:rgba(16,185,129,.14);border:1px solid rgba(16,185,129,.5);border-radius:12px;padding:12px 14px;margin:14px 0;font-weight:700}
.resume-bar.show{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.manual-box{margin-top:12px;border-top:1px dashed var(--border);padding-top:12px}
.file-input{width:100%;padding:10px;background:#0B0F19;border:1px dashed var(--border);border-radius:12px;color:var(--text)}
.checkbox-row{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px}
`;

function layout(title, bodyHtml, extraScript) {
  return (
    "<!DOCTYPE html>\n" +
    '<html lang="ar" dir="rtl">\n' +
    "<head>\n" +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    "<title>" + escapeHtml(title) + " | AniDoa</title>\n" +
    '<meta name="description" content="AniDoa — مشاهدة الدونغهوا (الأنمي الصيني) بترجمة عربية احترافية بالذكاء الاصطناعي.">\n' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">\n' +
    "<style>" + BASE_CSS + "</style>\n" +
    "</head>\n" +
    "<body>\n" +
    '<header class="site"><div class="header-inner">' +
    '<a class="brand" href="/">' + logoSVG(42) + '<span class="logo-text">Ani<em>Doa</em><small>دونغهوا بترجمة عربية ذكية</small></span></a>' +
    '<nav class="nav"><a href="/">الرئيسية</a></nav>' +
    "</div></header>\n" +
    '<main class="container">' + bodyHtml + "</main>\n" +
    "<footer>صُنع بحب لمحبي الدونغهوا — AniDoa &copy; " + new Date().getFullYear() + " — الترجمة تتم بالذكاء الاصطناعي وقد تحتوي على أخطاء بسيطة.</footer>\n" +
    (extraScript || "") +
    "\n</body>\n</html>"
  );
}

export function renderErrorPage(title, message) {
  const body =
    '<h1>' + escapeHtml(title) + '</h1>' +
    '<div class="empty"><b>حدثت مشكلة</b>' + escapeHtml(message || "") + '<br><br><a class="btn" href="/">العودة إلى الرئيسية</a></div>';
  return layout(title, body, "");
}

export function renderHome(seriesList) {
  const list = Array.isArray(seriesList) ? seriesList : [];
  const cardsHtml = list
    .map((s) => {
      const thumb = s.thumbnail
        ? '<img class="thumb" src="' + escapeHtml(s.thumbnail) + '" alt="" loading="lazy">'
        : '<div class="thumb" style="aspect-ratio:16/9;background:#1B2438;display:flex;align-items:center;justify-content:center;font-size:32px">🎬</div>';
      return (
        '<article class="card" data-title="' + escapeHtml((s.title || "").toLowerCase()) + '" data-playlist="' + escapeHtml(s.playlistId) + '">' +
        '<a href="/watch?playlist=' + encodeURIComponent(s.playlistId) + '">' + thumb + "</a>" +
        '<div class="card-body">' +
        '<div class="card-title">' + escapeHtml(s.title || "مسلسل بدون عنوان") + "</div>" +
        '<div class="card-meta"><span>📺 ' + (s.episodeCount || 0) + " حلقة</span>" +
        (s.truncated ? '<span class="badge">أول 500 حلقة</span>' : "") +
        '<span class="continue-badge" data-continue-for="' + escapeHtml(s.playlistId) + '"></span></div>' +
        '<div class="card-actions">' +
        '<a class="btn small" href="/watch?playlist=' + encodeURIComponent(s.playlistId) + '">مشاهدة</a>' +
        '<button class="btn small ghost" onclick="resumeSeries(\'' + escapeHtml(s.playlistId) + '\')">متابعة</button>' +
        "</div></div></article>"
      );
    })
    .join("");

  const body =
    "<h1>مكتبة الدونغهوا</h1>" +
    '<p class="subtitle">شاهد الأنمي الصيني (الدونغهوا) بترجمة عربية احترافية بالذكاء الاصطناعي — مجاناً بالكامل.</p>' +
    '<div class="searchbar"><input id="searchInput" type="search" placeholder="ابحث عن مسلسل..." aria-label="بحث"></div>' +
    '<div id="resumeBar" class="resume-bar"></div>' +
    (list.length === 0
      ? '<div class="empty"><b>لا توجد مسلسلات بعد</b>أضف أول مسلسل من النموذج بالأسفل عبر رابط قائمة تشغيل يوتيوب.</div>'
      : '<div class="grid" id="seriesGrid">' + cardsHtml + "</div>") +
    '<div id="noResults" class="empty" style="display:none"><b>لا توجد نتائج مطابقة</b>جرّب كلمة بحث أخرى.</div>' +
    '<section class="panel"><h2>إضافة مسلسل جديد</h2>' +
    '<p class="subtitle">الصق رابط قائمة تشغيل يوتيوب مرة واحدة فقط — سنحفظ الحلقات ونترجم كل حلقة مرة واحدة فقط.</p>' +
    '<div id="addAlert" class="alert"></div>' +
    '<form id="addForm">' +
    '<div class="field"><label for="playlistUrl">رابط قائمة التشغيل (YouTube Playlist)</label>' +
    '<input id="playlistUrl" type="url" dir="ltr" placeholder="https://www.youtube.com/playlist?list=..." required>' +
    '<div class="hint">مثال: رابط يحتوي على list=PLxxxxxxxx</div></div>' +
    '<div class="field"><label for="adminSecret">كلمة سر المدير</label>' +
    '<input id="adminSecret" type="password" placeholder="ADMIN_SECRET" autocomplete="off" required></div>' +
    '<button class="btn" type="submit" id="addBtn">إضافة المسلسل</button>' +
    "</form></section>";

  const script =
    "<script>\n" +
    "var SERIES_INDEX = " + safeJsonForHtml(list) + ";\n" +
    "function showAlert(id, msg, kind) {\n" +
    "  var el = document.getElementById(id);\n" +
    "  el.textContent = msg;\n" +
    "  el.className = 'alert show ' + (kind || 'info');\n" +
    "}\n" +
    "function resumeSeries(playlistId) {\n" +
    "  try {\n" +
    "    var last = localStorage.getItem('anidoa_last_' + playlistId);\n" +
    "    if (last) { window.location.href = '/watch?playlist=' + encodeURIComponent(playlistId) + '&episode=' + encodeURIComponent(last); return; }\n" +
    "  } catch (e) {}\n" +
    "  window.location.href = '/watch?playlist=' + encodeURIComponent(playlistId);\n" +
    "}\n" +
    "function refreshContinueBadges() {\n" +
    "  try {\n" +
    "    var badges = document.querySelectorAll('[data-continue-for]');\n" +
    "    badges.forEach(function (b) {\n" +
    "      var pid = b.getAttribute('data-continue-for');\n" +
    "      var last = localStorage.getItem('anidoa_last_' + pid);\n" +
    "      if (last) { b.innerHTML = '<span class=\\'badge green\\'>متابعة المشاهدة</span>'; }\n" +
    "    });\n" +
    "    var progressRaw = localStorage.getItem('anidoa_progress');\n" +
    "    if (progressRaw) {\n" +
    "      var progress = JSON.parse(progressRaw);\n" +
    "      var keys = Object.keys(progress || {});\n" +
    "      if (keys.length > 0) {\n" +
    "        keys.sort(function (a, b) { return (progress[b].at || 0) - (progress[a].at || 0); });\n" +
    "        var latest = progress[keys[0]];\n" +
    "        var bar = document.getElementById('resumeBar');\n" +
    "        if (latest && latest.playlistId && latest.videoId) {\n" +
    "          bar.innerHTML = '<span>متابعة من الحلقة: ' + escapeText(latest.title || '') + '</span>' +\n" +
    "            '<a class=\\'btn small secondary\\' href=\\'/watch?playlist=' + encodeURIComponent(latest.playlistId) + '&episode=' + encodeURIComponent(latest.videoId) + '\\'>متابعة المشاهدة</a>';\n" +
    "          bar.classList.add('show');\n" +
    "        }\n" +
    "      }\n" +
    "    }\n" +
    "  } catch (e) {}\n" +
    "}\n" +
    "function escapeText(s) {\n" +
    "  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');\n" +
    "}\n" +
    "document.getElementById('searchInput').addEventListener('input', function (e) {\n" +
    "  var q = (e.target.value || '').trim().toLowerCase();\n" +
    "  var cards = document.querySelectorAll('#seriesGrid .card');\n" +
    "  var visible = 0;\n" +
    "  cards.forEach(function (c) {\n" +
    "    var title = c.getAttribute('data-title') || '';\n" +
    "    var show = !q || title.indexOf(q) !== -1;\n" +
    "    c.style.display = show ? '' : 'none';\n" +
    "    if (show) visible++;\n" +
    "  });\n" +
    "  var noResults = document.getElementById('noResults');\n" +
    "  if (noResults) noResults.style.display = (cards.length > 0 && visible === 0) ? '' : 'none';\n" +
    "});\n" +
    "document.getElementById('addForm').addEventListener('submit', async function (e) {\n" +
    "  e.preventDefault();\n" +
    "  var btn = document.getElementById('addBtn');\n" +
    "  var url = document.getElementById('playlistUrl').value.trim();\n" +
    "  var secret = document.getElementById('adminSecret').value;\n" +
    "  btn.disabled = true; btn.textContent = 'جارٍ إضافة المسلسل...';\n" +
    "  showAlert('addAlert', 'جارٍ جلب الحلقات من يوتيوب...', 'info');\n" +
    "  try {\n" +
    "    var res = await fetch('/api/series', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playlistUrl: url, adminSecret: secret }) });\n" +
    "    var data = await res.json().catch(function () { return {}; });\n" +
    "    if (!res.ok) throw new Error(data.error || 'فشلت إضافة المسلسل.');\n" +
    "    showAlert('addAlert', 'تمت إضافة المسلسل بنجاح: ' + (data.series && data.series.title ? data.series.title : ''), 'success');\n" +
    "    setTimeout(function () { window.location.reload(); }, 1200);\n" +
    "  } catch (err) {\n" +
    "    showAlert('addAlert', err.message || 'حدث خطأ أثناء الإضافة.', 'error');\n" +
    "    btn.disabled = false; btn.textContent = 'إضافة المسلسل';\n" +
    "  }\n" +
    "});\n" +
    "refreshContinueBadges();\n" +
    "</script>";

  return layout("الرئيسية", body, script);
}

export function renderWatchPage(series, episode, episodes) {
  const eps = Array.isArray(episodes) ? episodes : [];
  const currentIndex = eps.findIndex((ep) => ep.videoId === episode.videoId);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const prevEp = safeIndex > 0 ? eps[safeIndex - 1] : null;
  const nextEp = safeIndex < eps.length - 1 ? eps[safeIndex + 1] : null;

  const epListHtml = eps
    .map((ep, i) => {
      const isCurrent = i === safeIndex;
      const thumb = ep.thumbnail
        ? '<img src="' + escapeHtml(ep.thumbnail) + '" alt="" loading="lazy">'
        : '<span style="width:120px;aspect-ratio:16/9;background:#0F172A;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">🎬</span>';
      return (
        '<button class="ep-item' + (isCurrent ? " current" : "") + '" data-video="' + escapeHtml(ep.videoId) + '" data-index="' + i + '" onclick="goToEpisode(' + i + ')">' +
        thumb +
        '<span><span class="ep-num">الحلقة ' + (i + 1) + (isCurrent ? " • تشاهد الآن" : "") + "</span><br>" +
        '<span class="ep-title">' + escapeHtml(ep.title || "حلقة بدون عنوان") + "</span></span>" +
        "</button>"
      );
    })
    .join("");

  const body =
    '<a class="btn small ghost" href="/" style="margin-top:16px;display:inline-block">← العودة إلى المكتبة</a>' +
    '<h1 class="watch-title">' + escapeHtml(series.title || "مسلسل") + "</h1>" +
    '<p class="watch-sub">الحلقة ' + (safeIndex + 1) + " من " + eps.length + " — " + escapeHtml(episode.title || "") + "</p>" +
    (series.truncated
      ? '<div class="alert info show" style="margin-top:12px">تم عرض أول 500 حلقة فقط من هذا المسلسل (الحد الأقصى للحلقات المحفوظة لكل مسلسل).</div>'
      : "") +
    '<div class="player-wrap"><div id="yt-player"></div>' +
    '<div class="subtitle-overlay" id="subtitleOverlay" aria-live="off"><span id="subtitleText" style="display:none"></span></div></div>' +
    '<div id="subStatus" class="alert info show" style="margin-top:12px"><span class="spinner"></span> جارٍ تحميل الترجمة العربية...</div>' +
    '<div class="controls">' +
    '<div class="controls-row"><span class="controls-label">حجم الخط</span>' +
    '<button class="chip" id="fontDown" type="button">− تصغير</button>' +
    '<span class="sync-value" id="fontSizeLabel">20px</span>' +
    '<button class="chip" id="fontUp" type="button">+ تكبير</button></div>' +
    '<div class="controls-row"><span class="controls-label">لون الترجمة</span>' +
    '<button class="chip active" id="colorWhite" type="button">أبيض</button>' +
    '<button class="chip" id="colorYellow" type="button">أصفر</button>' +
    '<span class="controls-label" style="min-width:0">شفافية الخلفية</span>' +
    '<input type="range" id="bgOpacity" min="0" max="0.9" step="0.1" value="0.6">' +
    '<span class="sync-value" id="bgOpacityLabel">0.6</span></div>' +
    '<div class="controls-row"><span class="controls-label">مزامنة التوقيت</span>' +
    '<button class="chip" id="syncMinus" type="button">− 0.5 ثانية</button>' +
    '<span class="sync-value" id="syncLabel">0.0s</span>' +
    '<button class="chip" id="syncPlus" type="button">+ 0.5 ثانية</button>' +
    '<button class="chip" id="syncReset" type="button">إعادة ضبط</button></div>' +
    '<div class="controls-row"><span class="controls-label">الترجمة العربية</span>' +
    '<button class="chip" id="downloadSrtBtn" type="button" disabled>تحميل الترجمة (.srt)</button></div>' +
    '<div class="controls-row"><label class="checkbox-row"><input type="checkbox" id="autoNext" checked> تشغيل الحلقة التالية تلقائياً عند الانتهاء</label></div>' +
    "</div>" +
    '<div class="ep-nav">' +
    (prevEp
      ? '<button class="btn ghost" type="button" onclick="goToEpisode(' + (safeIndex - 1) + ')">→ الحلقة السابقة</button>'
      : '<button class="btn ghost" type="button" disabled>→ الحلقة السابقة</button>') +
    (nextEp
      ? '<button class="btn" type="button" onclick="goToEpisode(' + (safeIndex + 1) + ')">الحلقة التالية ←</button>'
      : '<button class="btn" type="button" disabled>الحلقة التالية ←</button>') +
    "</div>" +
    '<div id="manualBox" class="panel" style="display:none">' +
    "<h2>هذه الحلقة بدون ترجمة إنجليزية</h2>" +
    '<p class="subtitle">قد تكون الحلقة مترجمة داخل الفيديو نفسه (Hardsub) أو لم يوفّر الناشر ملف ترجمة. يمكنك رفع ملف ترجمة أو لصق نصها وسيترجمها السيرفر فوراً.</p>' +
    '<div id="manualAlert" class="alert"></div>' +
    '<div class="field"><label for="srtFile">رفع ملف ترجمة (.srt أو .vtt)</label>' +
    '<input class="file-input" id="srtFile" type="file" accept=".srt,.vtt,text/plain"></div>' +
    '<div class="field"><label for="srtText">أو الصق نص الترجمة هنا</label>' +
    '<textarea id="srtText" dir="ltr" placeholder="1&#10;00:00:01,000 --> 00:00:03,000&#10;Hello world..."></textarea></div>' +
    '<div class="field"><label for="manualAdminSecret">كلمة سر المدير</label>' +
    '<input id="manualAdminSecret" type="password" placeholder="ADMIN_SECRET" autocomplete="off">' +
    '<div class="hint">الترجمة اليدوية محمية بكلمة سر المدير، ولا تُحفظ كلمة السر في أي مكان.</div></div>' +
    '<button class="btn secondary" type="button" id="manualBtn">ترجم الآن</button>' +
    "</div>" +
    '<section class="episodes"><h2>كل الحلقات (' + eps.length + ")</h2>" +
    '<div class="ep-list">' + epListHtml + "</div></section>";

  const script =
    "<script>\n" +
    "var PLAYLIST_ID = " + safeJsonForHtml(series.playlistId) + ";\n" +
    "var EPISODES = " + safeJsonForHtml(eps) + ";\n" +
    "var CURRENT_INDEX = " + safeIndex + ";\n" +
    "var CURRENT_VIDEO_ID = " + safeJsonForHtml(episode.videoId) + ";\n" +
    "var subtitles = [];\n" +
    "var lastCueIndex = -1;\n" +
    "var rateLimitTimer = null;\n" +
    // دوال cues.js مكتفية ذاتياً — نضمّنها في سكربت المشغل عبر .toString().
    "var findActiveCue = " + findActiveCue.toString() + ";\n" +
    "var cuesToSrt = " + cuesToSrt.toString() + ";\n" +
    "var sortCues = " + sortCues.toString() + ";\n" +
    "var player = null;\n" +
    "var syncTimer = null;\n" +
    "var PREFS_KEY = 'anidoa_sub_prefs';\n" +
    "var prefs = { fontSize: 20, color: '#FFFFFF', bgOpacity: 0.6, offset: 0 };\n" +
    "try { var savedPrefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); if (savedPrefs) prefs = Object.assign(prefs, savedPrefs); } catch (e) {}\n" +
    "if (prefs.fontSize < 14) prefs.fontSize = 14;\n" +
    "if (prefs.fontSize > 32) prefs.fontSize = 32;\n" +
    "if (prefs.bgOpacity < 0) prefs.bgOpacity = 0;\n" +
    "if (prefs.bgOpacity > 0.9) prefs.bgOpacity = 0.9;\n" +
    "function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }\n" +
    "function saveProgress() {\n" +
    "  try {\n" +
    "    localStorage.setItem('anidoa_last_' + PLAYLIST_ID, CURRENT_VIDEO_ID);\n" +
    "    var raw = localStorage.getItem('anidoa_progress');\n" +
    "    var progress = raw ? JSON.parse(raw) : {};\n" +
    "    progress[PLAYLIST_ID] = { playlistId: PLAYLIST_ID, videoId: CURRENT_VIDEO_ID, title: (EPISODES[CURRENT_INDEX] && EPISODES[CURRENT_INDEX].title) || '', at: Date.now() };\n" +
    "    localStorage.setItem('anidoa_progress', JSON.stringify(progress));\n" +
    "  } catch (e) {}\n" +
    "}\n" +
    "function showStatus(msg, kind, withRetry) {\n" +
    "  var el = document.getElementById('subStatus');\n" +
    "  el.className = 'alert show ' + (kind || 'info');\n" +
    "  el.innerHTML = '';\n" +
    "  var span = document.createElement('span');\n" +
    "  span.textContent = msg;\n" +
    "  el.appendChild(span);\n" +
    "  if (withRetry) {\n" +
    "    var btn = document.createElement('button');\n" +
    "    btn.className = 'btn small secondary';\n" +
    "    btn.style.marginInlineStart = '10px';\n" +
    "    btn.textContent = 'إعادة المحاولة';\n" +
    "    btn.onclick = function () { loadSubtitles(true); };\n" +
    "    el.appendChild(btn);\n" +
    "  }\n" +
    "}\n" +
    "function applyPrefs() {\n" +
    "  var text = document.getElementById('subtitleText');\n" +
    "  text.style.fontSize = prefs.fontSize + 'px';\n" +
    "  text.style.color = prefs.color;\n" +
    "  text.style.backgroundColor = 'rgba(0,0,0,' + prefs.bgOpacity + ')';\n" +
    "  text.style.textShadow = '0 2px 6px rgba(0,0,0,0.9)';\n" +
    "  document.getElementById('fontSizeLabel').textContent = prefs.fontSize + 'px';\n" +
    "  document.getElementById('bgOpacityLabel').textContent = String(prefs.bgOpacity);\n" +
    "  document.getElementById('bgOpacity').value = String(prefs.bgOpacity);\n" +
    "  var sign = prefs.offset > 0 ? '+' : '';\n" +
    "  document.getElementById('syncLabel').textContent = sign + prefs.offset.toFixed(1) + 's';\n" +
    "  document.getElementById('colorWhite').classList.toggle('active', prefs.color === '#FFFFFF');\n" +
    "  document.getElementById('colorYellow').classList.toggle('active', prefs.color === '#FDE047');\n" +
    "}\n" +
    "function tickSubtitles() {\n" +
    "  if (!player || typeof player.getCurrentTime !== 'function') return;\n" +
    "  var textEl = document.getElementById('subtitleText');\n" +
    "  var time = 0;\n" +
    "  try { time = player.getCurrentTime() || 0; } catch (e) { return; }\n" +
    "  var res = findActiveCue(subtitles, time + prefs.offset, lastCueIndex);\n" +
    "  lastCueIndex = res.index;\n" +
    "  var text = res.cue ? res.cue.text : '';\n" +
    "  if (text) { textEl.textContent = text; textEl.style.display = 'inline-block'; }\n" +
    "  else { textEl.textContent = ''; textEl.style.display = 'none'; }\n" +
    "}\n" +
    "function startRateLimitCountdown(seconds, baseMsg) {\n" +
    "  var remaining = seconds;\n" +
    "  if (rateLimitTimer) clearInterval(rateLimitTimer);\n" +
    "  function renderCountdown() {\n" +
    "    var el = document.getElementById('subStatus');\n" +
    "    el.className = 'alert show info';\n" +
    "    el.style.display = '';\n" +
    "    el.innerHTML = '';\n" +
    "    var span = document.createElement('span');\n" +
    "    span.textContent = baseMsg + ' حاول بعد ' + remaining + ' ثانية.';\n" +
    "    el.appendChild(span);\n" +
    "    if (remaining <= 0) {\n" +
    "      var btn = document.createElement('button');\n" +
    "      btn.className = 'btn small secondary';\n" +
    "      btn.style.marginInlineStart = '10px';\n" +
    "      btn.textContent = 'إعادة المحاولة';\n" +
    "      btn.onclick = function () { loadSubtitles(true); };\n" +
    "      el.appendChild(btn);\n" +
    "    }\n" +
    "  }\n" +
    "  renderCountdown();\n" +
    "  rateLimitTimer = setInterval(function () {\n" +
    "    remaining--;\n" +
    "    if (remaining <= 0) { remaining = 0; clearInterval(rateLimitTimer); rateLimitTimer = null; }\n" +
    "    renderCountdown();\n" +
    "  }, 1000);\n" +
    "}\n" +
    "async function loadSubtitles(isRetry) {\n" +
    "  var statusEl = document.getElementById('subStatus');\n" +
    "  if (rateLimitTimer) { clearInterval(rateLimitTimer); rateLimitTimer = null; }\n" +
    "  statusEl.className = 'alert info show';\n" +
    "  statusEl.style.display = '';\n" +
    "  statusEl.innerHTML = '<span class=\\'spinner\\'></span> جارٍ تحميل الترجمة العربية...';\n" +
    "  document.getElementById('manualBox').style.display = 'none';\n" +
    "  subtitles = [];\n" +
    "  lastCueIndex = -1;\n" +
    "  document.getElementById('downloadSrtBtn').disabled = true;\n" +
    "  try {\n" +
    "    var res = await fetch('/api/subtitles?videoId=' + encodeURIComponent(CURRENT_VIDEO_ID) + '&playlist=' + encodeURIComponent(PLAYLIST_ID));\n" +
    "    var data = await res.json().catch(function () { return {}; });\n" +
    "    if (res.status === 429) {\n" +
    "      var retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10) || 60;\n" +
    "      startRateLimitCountdown(retryAfter, (data && data.error) || 'تم تجاوز حد الترجمة المؤقت.');\n" +
    "      return;\n" +
    "    }\n" +
    "    if (res.status === 404 && data && data.code === 'NOT_IN_LIBRARY') {\n" +
    "      showStatus('الحلقة غير موجودة في مكتبة AniDoa.', 'error', false);\n" +
    "      var homeLink = document.createElement('a');\n" +
    "      homeLink.className = 'btn small ghost';\n" +
    "      homeLink.style.marginInlineStart = '10px';\n" +
    "      homeLink.href = '/';\n" +
    "      homeLink.textContent = 'العودة إلى المكتبة';\n" +
    "      document.getElementById('subStatus').appendChild(homeLink);\n" +
    "      return;\n" +
    "    }\n" +
    "    if (res.status === 404 && data && data.code === 'NO_SUBTITLES') {\n" +
    "      showStatus('هذه الحلقة بدون ترجمة إنجليزية — قد تكون مترجمة داخل الفيديو (Hardsub). يمكنك رفع ملف ترجمة بالأسفل.', 'info', false);\n" +
    "      document.getElementById('manualBox').style.display = '';\n" +
    "      return;\n" +
    "    }\n" +
    "    if (res.status === 400) {\n" +
    "      showStatus((data && data.error) || 'بيانات الطلب غير صالحة.', 'error', false);\n" +
    "      return;\n" +
    "    }\n" +
    "    if (!res.ok) throw new Error((data && data.error) || 'تعذّر تحميل الترجمة.');\n" +
    "    subtitles = sortCues(Array.isArray(data.subtitles) ? data.subtitles : []);\n" +
    "    if (subtitles.length === 0) throw new Error('الترجمة المترجمة فارغة.');\n" +
    "    document.getElementById('downloadSrtBtn').disabled = false;\n" +
    "    showStatus('تم تحميل الترجمة العربية بنجاح (' + subtitles.length + ' سطراً).', 'success', false);\n" +
    "    setTimeout(function () { document.getElementById('subStatus').style.display = 'none'; }, 3500);\n" +
    "  } catch (err) {\n" +
    "    showStatus(err.message || 'تعذّر تحميل الترجمة.', 'error', true);\n" +
    "  }\n" +
    "}\n" +
    "function goToEpisode(index) {\n" +
    "  if (index < 0 || index >= EPISODES.length) return;\n" +
    "  var ep = EPISODES[index];\n" +
    "  window.location.href = '/watch?playlist=' + encodeURIComponent(PLAYLIST_ID) + '&episode=' + encodeURIComponent(ep.videoId);\n" +
    "}\n" +
    "function onYouTubeIframeAPIReady() {\n" +
    "  player = new YT.Player('yt-player', {\n" +
    "    videoId: CURRENT_VIDEO_ID,\n" +
    "    playerVars: { cc_load_policy: 0, iv_load_policy: 3, modestbranding: 1, rel: 0, hl: 'ar', playsinline: 1 },\n" +
    "    events: {\n" +
    "      onReady: function () { saveProgress(); if (syncTimer) clearInterval(syncTimer); syncTimer = setInterval(tickSubtitles, 100); },\n" +
    "      onStateChange: function (event) {\n" +
    "        if (event.data === YT.PlayerState.ENDED) {\n" +
    "          var auto = document.getElementById('autoNext');\n" +
    "          if (auto && auto.checked && CURRENT_INDEX < EPISODES.length - 1) { goToEpisode(CURRENT_INDEX + 1); }\n" +
    "        }\n" +
    "        if (event.data === YT.PlayerState.PLAYING) { saveProgress(); }\n" +
    "      }\n" +
    "    }\n" +
    "  });\n" +
    "}\n" +
    "document.getElementById('fontUp').addEventListener('click', function () { if (prefs.fontSize < 32) prefs.fontSize += 2; savePrefs(); applyPrefs(); });\n" +
    "document.getElementById('fontDown').addEventListener('click', function () { if (prefs.fontSize > 14) prefs.fontSize -= 2; savePrefs(); applyPrefs(); });\n" +
    "document.getElementById('colorWhite').addEventListener('click', function () { prefs.color = '#FFFFFF'; savePrefs(); applyPrefs(); });\n" +
    "document.getElementById('colorYellow').addEventListener('click', function () { prefs.color = '#FDE047'; savePrefs(); applyPrefs(); });\n" +
    "document.getElementById('bgOpacity').addEventListener('input', function (e) { prefs.bgOpacity = parseFloat(e.target.value); savePrefs(); applyPrefs(); });\n" +
    "document.getElementById('syncPlus').addEventListener('click', function () { prefs.offset = Math.round((prefs.offset + 0.5) * 10) / 10; savePrefs(); applyPrefs(); });\n" +
    "document.getElementById('syncMinus').addEventListener('click', function () { prefs.offset = Math.round((prefs.offset - 0.5) * 10) / 10; savePrefs(); applyPrefs(); });\n" +
    "document.getElementById('syncReset').addEventListener('click', function () { prefs.offset = 0; savePrefs(); applyPrefs(); });\n" +
    "document.getElementById('srtFile').addEventListener('change', function (e) {\n" +
    "  var file = e.target.files && e.target.files[0];\n" +
    "  if (!file) return;\n" +
    "  var reader = new FileReader();\n" +
    "  reader.onload = function () { document.getElementById('srtText').value = String(reader.result || ''); };\n" +
    "  reader.readAsText(file);\n" +
    "});\n" +
    "document.getElementById('manualBtn').addEventListener('click', async function () {\n" +
    "  var btn = document.getElementById('manualBtn');\n" +
    "  var alertEl = document.getElementById('manualAlert');\n" +
    "  var text = document.getElementById('srtText').value.trim();\n" +
    "  var secret = document.getElementById('manualAdminSecret').value;\n" +
    "  if (!text || text.length < 10) { alertEl.textContent = 'الصق نص ترجمة كاملاً أو ارفع ملف .srt أولاً.'; alertEl.className = 'alert show error'; return; }\n" +
    "  if (!secret) { alertEl.textContent = 'أدخل كلمة سر المدير لترجمة الملف.'; alertEl.className = 'alert show error'; return; }\n" +
    "  btn.disabled = true; btn.textContent = 'جارٍ ترجمة الملف...';\n" +
    "  alertEl.textContent = 'جارٍ ترجمة الملف بالذكاء الاصطناعي — قد يستغرق هذا دقيقة.'; alertEl.className = 'alert show info';\n" +
    "  try {\n" +
    "    var res = await fetch('/api/translate-manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: CURRENT_VIDEO_ID, playlistId: PLAYLIST_ID, srtText: text, adminSecret: secret }) });\n" +
    "    var data = await res.json().catch(function () { return {}; });\n" +
    "    if (res.status === 403) throw new Error('كلمة سر المدير غير صحيحة.');\n" +
    "    if (res.status === 429) { var ra = res.headers.get('Retry-After'); throw new Error((data.error || 'تم تجاوز حد الترجمة.') + (ra ? ' حاول بعد ' + ra + ' ثانية.' : '')); }\n" +
    "    if (!res.ok) throw new Error(data.error || 'فشلت ترجمة الملف.');\n" +
    "    subtitles = sortCues(Array.isArray(data.subtitles) ? data.subtitles : []);\n" +
    "    lastCueIndex = -1;\n" +
    "    document.getElementById('downloadSrtBtn').disabled = false;\n" +
    "    alertEl.textContent = 'تمت ترجمة الملف بنجاح (' + subtitles.length + ' سطراً).'; alertEl.className = 'alert show success';\n" +
    "    showStatus('تمت ترجمة الملف المرفوع بنجاح.', 'success', false);\n" +
    "  } catch (err) {\n" +
    "    alertEl.textContent = err.message || 'فشلت ترجمة الملف.'; alertEl.className = 'alert show error';\n" +
    "  } finally { btn.disabled = false; btn.textContent = 'ترجم الآن'; }\n" +
    "});\n" +
    "document.getElementById('downloadSrtBtn').addEventListener('click', function () {\n" +
    "  if (!subtitles || subtitles.length === 0) return;\n" +
    "  var srt = cuesToSrt(subtitles);\n" +
    "  var blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });\n" +
    "  var url = URL.createObjectURL(blob);\n" +
    "  var a = document.createElement('a');\n" +
    "  a.href = url;\n" +
    "  a.download = 'AniDoa-' + CURRENT_VIDEO_ID + '.srt';\n" +
    "  document.body.appendChild(a);\n" +
    "  a.click();\n" +
    "  a.remove();\n" +
    "  setTimeout(function () { URL.revokeObjectURL(url); }, 5000);\n" +
    "});\n" +
    "applyPrefs();\n" +
    "saveProgress();\n" +
    "loadSubtitles(false);\n" +
    "</script>\n" +
    '<script src="https://www.youtube.com/iframe_api"></script>';

  return layout(series.title || "مشاهدة", body, script);
}
