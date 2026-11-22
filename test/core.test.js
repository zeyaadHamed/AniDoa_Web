import test from "node:test";
import assert from "node:assert/strict";

import { extractPlaylistId } from "../src/index.js";
import { parseSRT, parseVTT } from "../src/subtitles.js";
import { escapeHtml, safeJsonForHtml } from "../src/ui.js";

test("extracts a YouTube playlist id from a playlist URL", () => {
  assert.equal(
    extractPlaylistId("https://www.youtube.com/playlist?list=PL1234567890"),
    "PL1234567890"
  );
});

test("rejects a non-playlist YouTube video URL", () => {
  assert.equal(extractPlaylistId("https://youtu.be/dQw4w9WgXcQ"), null);
});

test("parses SRT cues and preserves timestamps", () => {
  const result = parseSRT(
    "1\n00:00:01,000 --> 00:00:02,500\nHello world\n\n" +
    "2\n00:00:03,000 --> 00:00:04,000\nNext line\n"
  );

  assert.deepEqual(result, [
    { start: 1, end: 2.5, text: "Hello world" },
    { start: 3, end: 4, text: "Next line" },
  ]);
});

test("parses WebVTT cues", () => {
  const result = parseVTT(
    "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n"
  );

  assert.deepEqual(result, [{ start: 1, end: 2, text: "Hello" }]);
});

test("escapes HTML text before rendering user-provided strings", () => {
  assert.equal(
    escapeHtml("<script>alert('x')</script>"),
    "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;"
  );
});

test("escapes script-breaking characters in inline JSON", () => {
  const safe = safeJsonForHtml({ value: "</script><b>&" });
  assert.equal(safe.includes("\\u003c/script\\u003e"), true);
  assert.equal(safe.includes("\\\\u003c/script\\\\u003e"), true);
});
