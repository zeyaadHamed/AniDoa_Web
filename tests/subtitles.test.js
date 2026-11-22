/**
 * AniDoa — tests/subtitles.test.js
 * اختبارات محللات الترجمة في src/subtitles.js (SRT / VTT / JSON3 / TimedText XML).
 * Node built-ins فقط — بدون أي اعتماديات.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSRT,
  parseVTT,
  parseJson3,
  parseTimedTextXML,
  srtTimeToSeconds,
  cleanCueText,
} from "../src/subtitles.js";

function approx(actual, expected) {
  assert.ok(
    Math.abs(actual - expected) < 0.001,
    "expected " + actual + " to be approximately " + expected
  );
}

describe("srtTimeToSeconds", () => {
  it("parses HH:MM:SS,mmm", () => {
    approx(srtTimeToSeconds("01:02:03,456"), 3723.456);
    assert.equal(srtTimeToSeconds("00:00:01,000"), 1);
    assert.equal(srtTimeToSeconds("00:00:00,500"), 0.5);
  });

  it("parses MM:SS.mmm and bare seconds", () => {
    assert.equal(srtTimeToSeconds("02:03.5"), 123.5);
    assert.equal(srtTimeToSeconds("45.25"), 45.25);
  });

  it("returns 0 for invalid input", () => {
    assert.equal(srtTimeToSeconds(""), 0);
    assert.equal(srtTimeToSeconds(null), 0);
    assert.equal(srtTimeToSeconds("not a time"), 0);
  });
});

describe("parseSRT", () => {
  it("parses two cues including a multiline cue", () => {
    const srt =
      "1\n00:00:01,000 --> 00:00:03,500\nHello world\nsecond line\n\n" +
      "2\n00:00:04,000 --> 00:00:06,000\nGoodbye\n";
    const cues = parseSRT(srt);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].start, 1);
    assert.equal(cues[0].end, 3.5);
    assert.equal(cues[0].text, "Hello world second line");
    assert.equal(cues[1].start, 4);
    assert.equal(cues[1].end, 6);
    assert.equal(cues[1].text, "Goodbye");
  });

  it("returns [] for empty or invalid input", () => {
    assert.deepEqual(parseSRT(""), []);
    assert.deepEqual(parseSRT(null), []);
    assert.deepEqual(parseSRT("no timestamps here"), []);
  });
});

describe("parseVTT", () => {
  it("parses a WebVTT file", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello VTT\n\n00:00:03.000 --> 00:00:04.000\nSecond cue\n";
    const cues = parseVTT(vtt);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].start, 1);
    assert.equal(cues[0].end, 2.5);
    assert.equal(cues[0].text, "Hello VTT");
    assert.equal(cues[1].text, "Second cue");
  });

  it("skips NOTE blocks", () => {
    const vtt = "WEBVTT\n\nNOTE this is a comment\n\n00:00:01.000 --> 00:00:02.000\nReal cue\n";
    const cues = parseVTT(vtt);
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, "Real cue");
  });
});

describe("parseJson3", () => {
  it("parses YouTube json3 events", () => {
    const json3 = {
      events: [
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "Hello " }, { utf8: "there" }] },
        { tStartMs: 4000, dDurationMs: 1000, segs: [{ utf8: "Next" }] },
        { tStartMs: 6000, dDurationMs: 1000 },
      ],
    };
    const cues = parseJson3(json3);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].start, 1);
    assert.equal(cues[0].end, 3);
    assert.equal(cues[0].text, "Hello there");
    assert.equal(cues[1].start, 4);
    assert.equal(cues[1].end, 5);
  });

  it("returns [] for missing events", () => {
    assert.deepEqual(parseJson3({}), []);
    assert.deepEqual(parseJson3(null), []);
  });
});

describe("parseTimedTextXML", () => {
  it("parses YouTube TimedText XML", () => {
    const xml =
      '<transcript><text start="1.2" dur="2.3">Hello &amp; goodbye</text>' +
      '<text start="4.0" dur="1.5">Next line</text></transcript>';
    const cues = parseTimedTextXML(xml);
    assert.equal(cues.length, 2);
    approx(cues[0].start, 1.2);
    approx(cues[0].end, 3.5);
    assert.equal(cues[0].text, "Hello & goodbye");
    assert.equal(cues[1].start, 4);
    assert.equal(cues[1].end, 5.5);
    assert.equal(cues[1].text, "Next line");
  });

  it("returns [] for empty input", () => {
    assert.deepEqual(parseTimedTextXML(""), []);
    assert.deepEqual(parseTimedTextXML("<transcript></transcript>"), []);
  });
});

describe("cleanCueText", () => {
  it("strips HTML tags", () => {
    assert.equal(cleanCueText("<b>Hello</b> <i>world</i>"), "Hello world");
    assert.equal(cleanCueText('<font color="red">Hi</font>'), "Hi");
  });

  it("decodes HTML entities", () => {
    assert.equal(cleanCueText("&lt;tag&gt; &amp; &quot;quoted&quot;"), '<tag> & "quoted"');
  });

  it("returns '' for empty input", () => {
    assert.equal(cleanCueText(""), "");
    assert.equal(cleanCueText(null), "");
  });
});
