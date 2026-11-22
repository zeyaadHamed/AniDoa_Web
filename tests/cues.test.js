/**
 * AniDoa — tests/cues.test.js
 * اختبارات محرك أسطر الترجمة في src/cues.js.
 * Node built-ins فقط — بدون أي اعتماديات.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findActiveCue, cuesToSrt, sortCues } from "../src/cues.js";

const CUES = [
  { start: 0, end: 2, text: "A" },
  { start: 3, end: 5, text: "B" },
  { start: 6, end: 8, text: "C" },
];

describe("findActiveCue", () => {
  it("returns null before the first cue", () => {
    assert.deepEqual(findActiveCue(CUES, -1, -1), { index: -1, cue: null });
  });

  it("matches at the exact start (start is inclusive)", () => {
    assert.deepEqual(findActiveCue(CUES, 0, -1), { index: 0, cue: CUES[0] });
    assert.deepEqual(findActiveCue(CUES, 3, -1), { index: 1, cue: CUES[1] });
    assert.deepEqual(findActiveCue(CUES, 6, -1), { index: 2, cue: CUES[2] });
  });

  it("matches mid-cue", () => {
    assert.deepEqual(findActiveCue(CUES, 1.5, -1), { index: 0, cue: CUES[0] });
    assert.deepEqual(findActiveCue(CUES, 4.99, -1), { index: 1, cue: CUES[1] });
    assert.deepEqual(findActiveCue(CUES, 7.9, -1), { index: 2, cue: CUES[2] });
  });

  it("returns null at the exact end (end is exclusive) and in gaps", () => {
    assert.deepEqual(findActiveCue(CUES, 2, -1), { index: -1, cue: null });
    assert.deepEqual(findActiveCue(CUES, 2.5, -1), { index: -1, cue: null });
    assert.deepEqual(findActiveCue(CUES, 5, -1), { index: -1, cue: null });
    assert.deepEqual(findActiveCue(CUES, 5.5, -1), { index: -1, cue: null });
  });

  it("returns null after the last cue", () => {
    assert.deepEqual(findActiveCue(CUES, 8, -1), { index: -1, cue: null });
    assert.deepEqual(findActiveCue(CUES, 100, -1), { index: -1, cue: null });
  });

  it("walks sequentially using lastIndex (fast path)", () => {
    assert.deepEqual(findActiveCue(CUES, 1.5, 0), { index: 0, cue: CUES[0] });
    assert.deepEqual(findActiveCue(CUES, 3.5, 0), { index: 1, cue: CUES[1] });
    assert.deepEqual(findActiveCue(CUES, 6.5, 1), { index: 2, cue: CUES[2] });
    assert.deepEqual(findActiveCue(CUES, 4.5, 2), { index: 1, cue: CUES[1] });
  });

  it("falls back to binary search on a big seek backwards", () => {
    assert.deepEqual(findActiveCue(CUES, 1.0, 2), { index: 0, cue: CUES[0] });
    assert.deepEqual(findActiveCue(CUES, 2.5, 0), { index: -1, cue: null });
  });

  it("handles empty cues and invalid input", () => {
    assert.deepEqual(findActiveCue([], 1, -1), { index: -1, cue: null });
    assert.deepEqual(findActiveCue(null, 1, -1), { index: -1, cue: null });
    assert.deepEqual(findActiveCue(CUES, NaN, -1), { index: -1, cue: null });
  });
});

describe("cuesToSrt", () => {
  it("produces exact SRT format including milliseconds", () => {
    const cues = [
      { start: 1, end: 3.5, text: "Hello" },
      { start: 62.25, end: 64, text: "World" },
    ];
    const expected =
      "1\n00:00:01,000 --> 00:00:03,500\nHello\n\n" +
      "2\n00:01:02,250 --> 00:01:04,000\nWorld\n";
    assert.equal(cuesToSrt(cues), expected);
  });

  it("formats hours correctly", () => {
    const cues = [{ start: 3723.456, end: 3725.5, text: "Late" }];
    assert.equal(cuesToSrt(cues), "1\n01:02:03,456 --> 01:02:05,500\nLate\n");
  });

  it("returns '' for empty input", () => {
    assert.equal(cuesToSrt([]), "");
    assert.equal(cuesToSrt(null), "");
  });
});

describe("sortCues", () => {
  it("returns a sorted copy without mutating the original", () => {
    const unsorted = [
      { start: 5, end: 6, text: "C" },
      { start: 1, end: 2, text: "A" },
      { start: 3, end: 4, text: "B" },
    ];
    const sorted = sortCues(unsorted);
    assert.deepEqual(
      sorted.map((c) => c.text),
      ["A", "B", "C"]
    );
    assert.deepEqual(
      unsorted.map((c) => c.text),
      ["C", "A", "B"]
    );
  });

  it("returns [] for non-array input", () => {
    assert.deepEqual(sortCues(null), []);
  });
});
