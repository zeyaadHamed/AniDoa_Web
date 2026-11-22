import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";

function makeKv(seed, options) {
  const store = new Map(Object.entries(seed || {}));
  const opts = options || {};
  return {
    async get(key) {
      if (opts.failRateLimitReads && key.startsWith("rl:")) {
        throw new Error("KV read unavailable");
      }
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      if (opts.failWrites) throw new Error("KV write unavailable");
      store.set(key, String(value));
    },
    async delete(key) {
      store.delete(key);
    },
    store,
  };
}

function makeLimiter(decision) {
  return {
    getByName(name) {
      assert.equal(name, "anidoa-global-translation-budget-v1");
      return {
        async claimTranslation() {
          if (decision instanceof Error) throw decision;
          return decision || { allowed: true };
        },
        async releaseTranslation() {},
      };
    },
  };
}

function jsonRequest(url, method, body, headers) {
  return new Request(url, {
    method: method || "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(body),
  });
}

const PLAYLIST_ID = "PL1234567890abcdef";
const VIDEO_ID = "dQw4w9WgXcQ";

test("health reports not-ready when required secrets are missing", async () => {
  const env = {
    ANIDOA_KV: makeKv(),
    ANIDOA_RATE_LIMITER: makeLimiter(),
  };
  const response = await worker.fetch(new Request("https://anidoa.test/api/health"), env);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.kv, "ok");
  assert.deepEqual(body.configuration, {
    youtube: false,
    gemini: false,
    admin: false,
  });
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
});

test("health reports ready only when KV and all required secrets are configured", async () => {
  const env = {
    ANIDOA_KV: makeKv(),
    YOUTUBE_API_KEY: "not-a-real-key",
    GEMINI_API_KEY: "not-a-real-key",
    ADMIN_SECRET: "test-only-secret",
    ANIDOA_RATE_LIMITER: makeLimiter(),
  };
  const response = await worker.fetch(new Request("https://anidoa.test/api/health"), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.kv, "ok");
  assert.equal(body.configuration.youtube, true);
  assert.equal(body.configuration.gemini, true);
  assert.equal(body.configuration.admin, true);
});

test("unknown episode URLs return 404 instead of silently opening episode one", async () => {
  const series = {
    playlistId: PLAYLIST_ID,
    title: "Test Donghua",
    episodes: [{ videoId: VIDEO_ID, title: "Episode one" }],
  };
  const env = {
    ANIDOA_KV: makeKv({
      ["playlist:" + PLAYLIST_ID]: JSON.stringify(series),
    }),
  };
  const response = await worker.fetch(
    new Request("https://anidoa.test/watch?playlist=" + PLAYLIST_ID + "&episode=abcdefghijk"),
    env
  );

  assert.equal(response.status, 404);
  assert.match(await response.text(), /الحلقة غير موجودة/);
});

test("manual translation requires administrator authentication", async () => {
  const series = {
    playlistId: PLAYLIST_ID,
    episodes: [{ videoId: VIDEO_ID, title: "Episode one" }],
  };
  const env = {
    ANIDOA_KV: makeKv({
      ["playlist:" + PLAYLIST_ID]: JSON.stringify(series),
    }),
    GEMINI_API_KEY: "not-a-real-key",
  };
  const response = await worker.fetch(
    jsonRequest("https://anidoa.test/api/translate-manual", "POST", {
      playlistId: PLAYLIST_ID,
      videoId: VIDEO_ID,
      srtText: "1\n00:00:01,000 --> 00:00:02,000\nHello\n",
    }),
    env
  );
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, "FORBIDDEN");
});

test("manual translation reuses a saved result without another Gemini call", async () => {
  const series = {
    playlistId: PLAYLIST_ID,
    episodes: [{ videoId: VIDEO_ID, title: "Episode one" }],
  };
  const saved = {
    videoId: VIDEO_ID,
    source: "innertube",
    translatedAt: "2026-11-23T00:00:00.000Z",
    subtitles: [{ start: 1, end: 2, text: "مرحباً" }],
  };
  const env = {
    ANIDOA_KV: makeKv({
      ["playlist:" + PLAYLIST_ID]: JSON.stringify(series),
      ["sub:" + VIDEO_ID]: JSON.stringify(saved),
    }),
    ADMIN_SECRET: "test-only-secret",
    GEMINI_API_KEY: "not-a-real-key",
  };
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Network should not be called for cached subtitles");
  };

  try {
    const response = await worker.fetch(
      jsonRequest("https://anidoa.test/api/translate-manual", "POST", {
        playlistId: PLAYLIST_ID,
        videoId: VIDEO_ID,
        srtText: "1\n00:00:01,000 --> 00:00:02,000\nReplacement\n",
        adminSecret: "test-only-secret",
      }),
      env
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.cached, true);
    assert.equal(body.subtitles[0].text, "مرحباً");
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("translation fails closed when the Durable Object rate limiter is unavailable", async () => {
  const series = {
    playlistId: PLAYLIST_ID,
    episodes: [{ videoId: VIDEO_ID, title: "Episode one" }],
  };
  const env = {
    ANIDOA_KV: makeKv({
      ["playlist:" + PLAYLIST_ID]: JSON.stringify(series),
    }),
    ANIDOA_RATE_LIMITER: makeLimiter(new Error("Durable Object unavailable")),
    GEMINI_API_KEY: "not-a-real-key",
  };
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Network should not be called while rate-limit storage is unavailable");
  };

  try {
    const response = await worker.fetch(
      new Request(
        "https://anidoa.test/api/subtitles?playlist=" +
          PLAYLIST_ID +
          "&videoId=" +
          VIDEO_ID
      ),
      env
    );
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.code, "STORAGE_UNAVAILABLE");
    assert.equal(response.headers.get("Retry-After"), "60");
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin JSON endpoints reject oversized Content-Length before parsing", async () => {
  const request = new Request("https://anidoa.test/api/series", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": "17000",
    },
    body: JSON.stringify({ playlistUrl: "https://youtube.com/playlist?list=" + PLAYLIST_ID }),
  });
  const response = await worker.fetch(request, {
    ANIDOA_KV: makeKv(),
    ADMIN_SECRET: "test-only-secret",
  });

  assert.equal(response.status, 413);
});
