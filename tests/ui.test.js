/**
 * AniDoa — tests/ui.test.js
 * اختبارات دخان (Smoke Tests) لواجهات src/ui.js.
 * Node built-ins فقط — بدون أي اعتماديات.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderHome, renderWatchPage, renderErrorPage, logoSVG } from "../src/ui.js";

const SAMPLE_SERIES = {
  playlistId: "PL1234567890abcdef",
  title: "Test Series",
  thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  episodeCount: 2,
  truncated: false,
};

const SAMPLE_EPISODES = [
  { videoId: "dQw4w9WgXcQ", title: "Episode One", thumbnail: "", position: 0, publishedAt: "" },
  { videoId: "abcdefghijk", title: "Episode Two", thumbnail: "", position: 1, publishedAt: "" },
];

describe("logoSVG", () => {
  it("returns an inline SVG with the Qi gradient", () => {
    const svg = logoSVG(40);
    assert.ok(svg.includes("<svg"));
    assert.ok(svg.includes("qiGrad"));
    assert.ok(svg.includes("#10B981"));
  });
});

describe("renderHome", () => {
  it("renders the library with logo, search and the add-series form", () => {
    const html = renderHome([SAMPLE_SERIES]);
    assert.ok(html.includes("<svg"), "logo SVG missing");
    assert.ok(html.includes("Test Series"), "series title missing");
    assert.ok(html.includes('id="searchInput"'), "search input missing");
    assert.ok(html.includes('id="addForm"'), "add-series form missing");
    assert.ok(html.includes('id="adminSecret"'), "admin secret field missing");
    assert.ok(html.includes("/watch?playlist=PL1234567890abcdef"), "watch link missing");
  });

  it("shows the truncated badge when a series is capped at 500 episodes", () => {
    const html = renderHome([{ ...SAMPLE_SERIES, truncated: true }]);
    assert.ok(html.includes("أول 500 حلقة"));
  });

  it("shows an empty state when the library is empty", () => {
    const html = renderHome([]);
    assert.ok(html.includes("لا توجد مسلسلات بعد"));
  });
});

describe("renderWatchPage", () => {
  const html = renderWatchPage(SAMPLE_SERIES, SAMPLE_EPISODES[0], SAMPLE_EPISODES);

  it("embeds the YouTube IFrame API and the subtitle overlay", () => {
    assert.ok(html.includes("iframe_api"), "YouTube IFrame API missing");
    assert.ok(html.includes('id="subtitleOverlay"'), "subtitle overlay missing");
    assert.ok(html.includes('id="subtitleText"'), "subtitle text element missing");
  });

  it("includes the subtitle sync controls", () => {
    assert.ok(html.includes('id="syncPlus"'), "sync + button missing");
    assert.ok(html.includes('id="syncMinus"'), "sync - button missing");
    assert.ok(html.includes('id="syncReset"'), "sync reset button missing");
    assert.ok(html.includes('id="fontUp"'), "font size up missing");
    assert.ok(html.includes('id="colorYellow"'), "color toggle missing");
    assert.ok(html.includes('id="bgOpacity"'), "background opacity slider missing");
  });

  it("includes the manual form WITH a password field", () => {
    assert.ok(html.includes('id="manualBox"'), "manual box missing");
    assert.ok(html.includes('id="manualAdminSecret"'), "manual admin password field missing");
    assert.ok(html.includes('type="password"'), "password input type missing");
    assert.ok(html.includes('id="srtFile"'), "SRT file input missing");
    assert.ok(html.includes('id="srtText"'), "SRT paste area missing");
    assert.ok(html.includes('id="manualBtn"'), "manual translate button missing");
  });

  it("includes the SRT download button", () => {
    assert.ok(html.includes('id="downloadSrtBtn"'), "SRT download button missing");
    assert.ok(html.includes("تحميل الترجمة (.srt)"), "SRT download label missing");
  });

  it("sends the playlist param when fetching subtitles", () => {
    assert.ok(html.includes("/api/subtitles?videoId="), "subtitles fetch URL missing");
    assert.ok(html.includes("&playlist="), "playlist param missing from subtitles fetch");
  });

  it("embeds the cue engine functions for the fast player loop", () => {
    assert.ok(html.includes("findActiveCue"), "findActiveCue not embedded in player script");
    assert.ok(html.includes("cuesToSrt"), "cuesToSrt not embedded in player script");
    assert.ok(html.includes("lastCueIndex"), "cached cue index missing");
  });

  it("shows next/previous navigation and the episode list", () => {
    assert.ok(html.includes("الحلقة التالية"), "next episode button missing");
    assert.ok(html.includes("الحلقة السابقة"), "previous episode button missing");
    assert.ok(html.includes("Episode One"), "episode list missing");
    assert.ok(html.includes("Episode Two"), "episode list missing");
    assert.ok(html.includes('id="autoNext"'), "autoplay checkbox missing");
  });

  it("shows a note when the series is truncated at 500 episodes", () => {
    const truncatedHtml = renderWatchPage(
      { ...SAMPLE_SERIES, truncated: true },
      SAMPLE_EPISODES[0],
      SAMPLE_EPISODES
    );
    assert.ok(truncatedHtml.includes("500 حلقة"));
  });
});

describe("renderErrorPage", () => {
  it("renders an Arabic error page with a home link", () => {
    const html = renderErrorPage("المسلسل غير موجود في مكتبة AniDoa", "اختر مسلسلاً من المكتبة.");
    assert.ok(html.includes("المسلسل غير موجود في مكتبة AniDoa"));
    assert.ok(html.includes('href="/"'));
  });
});
