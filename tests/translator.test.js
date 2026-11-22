/**
 * AniDoa — tests/translator.test.js
 * اختبارات محرك الترجمة في src/translator.js (بدون استدعاءات شبكة).
 * Node built-ins فقط — بدون أي اعتماديات.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanGeminiJson,
  chunkCues,
  buildPrompt,
  computeRetryDelay,
  getGenerationConfig,
  getActiveModel,
  DEFAULT_GEMINI_MODEL,
} from "../src/translator.js";

describe("cleanGeminiJson", () => {
  it("parses raw JSON", () => {
    const parsed = cleanGeminiJson('[{"start":1,"end":2,"text":"مرحبا"}]');
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].text, "مرحبا");
  });

  it("strips ```json fences", () => {
    const raw = "```json\n[{\"start\":1,\"end\":2,\"text\":\"مرحبا\"}]\n```";
    const parsed = cleanGeminiJson(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].start, 1);
  });

  it("extracts JSON from surrounding prose", () => {
    const raw = 'Here is the translation:\n[{"start":1,"end":2,"text":"x"}]\nHope this helps.';
    const parsed = cleanGeminiJson(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].text, "x");
  });

  it("throws when no JSON array is present", () => {
    assert.throws(() => cleanGeminiJson("no json here"), /مصفوفة JSON/);
    assert.throws(() => cleanGeminiJson(""), /فارغ/);
  });
});

describe("chunkCues", () => {
  function makeCues(n) {
    const cues = [];
    for (let i = 0; i < n; i++) {
      cues.push({ start: i, end: i + 1, text: "line " + i });
    }
    return cues;
  }

  it("splits 120 cues into 3 chunks of 50/50/20", () => {
    const chunks = chunkCues(makeCues(120), 50, 2);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].chunk.length, 50);
    assert.equal(chunks[1].chunk.length, 50);
    assert.equal(chunks[2].chunk.length, 20);
  });

  it("attaches the last 2 lines of the previous chunk as context only", () => {
    const cues = makeCues(120);
    const chunks = chunkCues(cues, 50, 2);
    assert.deepEqual(chunks[0].context, []);
    assert.deepEqual(chunks[1].context, [cues[48], cues[49]]);
    assert.deepEqual(chunks[2].context, [cues[98], cues[99]]);
  });

  it("excludes context lines from the chunk payload", () => {
    const cues = makeCues(120);
    const chunks = chunkCues(cues, 50, 2);
    assert.deepEqual(chunks[1].chunk[0], cues[50]);
    assert.deepEqual(chunks[1].chunk[49], cues[99]);
    assert.deepEqual(chunks[2].chunk[0], cues[100]);
  });

  it("handles a single small chunk with no context", () => {
    const chunks = chunkCues(makeCues(5), 50, 2);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chunk.length, 5);
    assert.deepEqual(chunks[0].context, []);
  });
});

describe("buildPrompt", () => {
  it("contains the Donghua glossary and the JSON format instruction", () => {
    const prompt = buildPrompt(
      [{ start: 1, end: 2, text: "Qi flows through the sect." }],
      []
    );
    assert.ok(prompt.includes("تشي"));
    assert.ok(prompt.includes("صقل"));
    assert.ok(prompt.includes("طائفة"));
    assert.ok(prompt.includes("تكوين النواة"));
    assert.ok(prompt.includes("الروح الوليدة"));
    assert.ok(prompt.includes('"start"'));
    assert.ok(prompt.includes('"end"'));
    assert.ok(prompt.includes('"text"'));
  });

  it("marks context as context-only", () => {
    const prompt = buildPrompt(
      [{ start: 10, end: 11, text: "New line." }],
      [{ start: 8, end: 9, text: "Previous line." }]
    );
    assert.ok(prompt.includes("سياق فقط"));
    assert.ok(prompt.includes("Previous line."));
    assert.ok(prompt.includes("New line."));
  });
});

describe("computeRetryDelay", () => {
  it("grows with the attempt number (base 2000/5000/10000ms × jitter 0.5–1.5)", () => {
    for (let i = 0; i < 20; i++) {
      const first = computeRetryDelay(0, null);
      assert.ok(first >= 1000 && first <= 3000, "attempt 0 delay out of range: " + first);
      const third = computeRetryDelay(2, null);
      assert.ok(third >= 5000 && third <= 15000, "attempt 2 delay out of range: " + third);
    }
    const second = computeRetryDelay(1, null);
    assert.ok(second >= 2500 && second <= 7500, "attempt 1 delay out of range: " + second);
  });

  it("honors the Retry-After header in seconds", () => {
    assert.equal(computeRetryDelay(0, "5"), 5000);
    assert.equal(computeRetryDelay(1, "2"), 2000);
    assert.equal(computeRetryDelay(0, 3), 3000);
  });

  it("caps Retry-After at 30000ms", () => {
    assert.equal(computeRetryDelay(0, "120"), 30000);
    assert.equal(computeRetryDelay(0, "45"), 30000);
    assert.equal(computeRetryDelay(0, "30"), 30000);
  });

  it("falls back to backoff for invalid Retry-After values", () => {
    const delay = computeRetryDelay(0, "not-a-number");
    assert.ok(delay >= 1000 && delay <= 3000);
    const zeroDelay = computeRetryDelay(0, "0");
    assert.ok(zeroDelay >= 1000 && zeroDelay <= 3000);
  });
});

describe("getGenerationConfig", () => {
  it("contains NO deprecated sampling params (temperature / top_p / top_k)", () => {
    const config = getGenerationConfig();
    assert.ok(!("temperature" in config), "temperature must not be sent to Gemini 3.5 models");
    assert.ok(!("top_p" in config), "top_p must not be sent to Gemini 3.5 models");
    assert.ok(!("top_k" in config), "top_k must not be sent to Gemini 3.5 models");
    assert.ok(!("topP" in config), "topP must not be sent to Gemini 3.5 models");
    assert.ok(!("topK" in config), "topK must not be sent to Gemini 3.5 models");
  });

  it("keeps maxOutputTokens and JSON response mode", () => {
    const config = getGenerationConfig();
    assert.equal(config.maxOutputTokens, 8192);
    assert.equal(config.responseMimeType, "application/json");
  });
});

describe("getActiveModel", () => {
  it("defaults to gemini-3.5-flash-lite", () => {
    assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");
    assert.equal(getActiveModel({}), "gemini-3.5-flash-lite");
    assert.equal(getActiveModel(undefined), "gemini-3.5-flash-lite");
    assert.equal(getActiveModel({ GEMINI_MODEL: "" }), "gemini-3.5-flash-lite");
  });

  it("honors the GEMINI_MODEL override", () => {
    assert.equal(getActiveModel({ GEMINI_MODEL: "custom-model" }), "custom-model");
    assert.equal(getActiveModel({ GEMINI_MODEL: "  spaced-model  " }), "spaced-model");
  });
});
