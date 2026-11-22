/**
 * AniDoa — tests/security.test.js
 * اختبارات أدوات الأمان النقية في src/security.js.
 * Node built-ins فقط (node:test + node:assert) — بدون أي اعتماديات.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  securityHeaders,
  withSecurityHeaders,
  extractPlaylistId,
  isValidVideoId,
  isValidPlaylistId,
  timingSafeEqual,
  getClientIp,
  hourBucket,
  dayBucket,
  rateLimitKey,
} from "../src/security.js";

describe("extractPlaylistId", () => {
  it("extracts list= from a playlist URL", () => {
    assert.equal(
      extractPlaylistId("https://www.youtube.com/playlist?list=PL1234567890abcdef"),
      "PL1234567890abcdef"
    );
  });

  it("extracts list= from a watch URL", () => {
    assert.equal(
      extractPlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcDEF123456"),
      "PLabcDEF123456"
    );
  });

  it("extracts list= from a youtu.be URL", () => {
    assert.equal(
      extractPlaylistId("https://youtu.be/dQw4w9WgXcQ?list=PLxyz987654321"),
      "PLxyz987654321"
    );
  });

  it("accepts a bare playlist ID", () => {
    assert.equal(extractPlaylistId("PL1234567890abcdef"), "PL1234567890abcdef");
  });

  it("returns null for invalid input", () => {
    assert.equal(extractPlaylistId(""), null);
    assert.equal(extractPlaylistId("not a url"), null);
    assert.equal(extractPlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
    assert.equal(extractPlaylistId(null), null);
    assert.equal(extractPlaylistId(undefined), null);
    assert.equal(extractPlaylistId(123), null);
  });
});

describe("isValidVideoId / isValidPlaylistId", () => {
  it("accepts valid YouTube video IDs (11 chars)", () => {
    assert.equal(isValidVideoId("dQw4w9WgXcQ"), true);
    assert.equal(isValidVideoId("aB3-_xY9z0Q"), true);
  });

  it("rejects invalid video IDs", () => {
    assert.equal(isValidVideoId("short"), false);
    assert.equal(isValidVideoId("dQw4w9WgXcQ1"), false);
    assert.equal(isValidVideoId("dQw4w9WgXc!"), false);
    assert.equal(isValidVideoId("dQw4w9WgXc Q"), false);
    assert.equal(isValidVideoId(""), false);
    assert.equal(isValidVideoId(null), false);
  });

  it("accepts valid playlist IDs (10–64 chars)", () => {
    assert.equal(isValidPlaylistId("PL1234567890abcdef"), true);
    assert.equal(isValidPlaylistId("UU12345678"), true);
    assert.equal(isValidPlaylistId("P".repeat(64)), true);
  });

  it("rejects invalid playlist IDs", () => {
    assert.equal(isValidPlaylistId("short"), false);
    assert.equal(isValidPlaylistId("P".repeat(65)), false);
    assert.equal(isValidPlaylistId("PL1234 5678"), false);
    assert.equal(isValidPlaylistId(""), false);
    assert.equal(isValidPlaylistId(null), false);
  });
});

describe("hourBucket / dayBucket / rateLimitKey", () => {
  it("formats hour buckets as YYYY-MM-DDTHH in UTC", () => {
    assert.equal(hourBucket(new Date("2026-11-23T01:23:45.000Z")), "2026-11-23T01");
    assert.equal(hourBucket(new Date("2026-01-05T23:59:59.000Z")), "2026-01-05T23");
  });

  it("formats day buckets as YYYY-MM-DD in UTC", () => {
    assert.equal(dayBucket(new Date("2026-11-23T01:23:45.000Z")), "2026-11-23");
    assert.equal(dayBucket(new Date("2026-01-05T23:59:59.000Z")), "2026-01-05");
  });

  it("builds rate limit keys as prefix:id:bucket", () => {
    assert.equal(rateLimitKey("rl", "1.2.3.4", "2026-11-23T01"), "rl:1.2.3.4:2026-11-23T01");
    assert.equal(rateLimitKey("rl", "global", "2026-11-23"), "rl:global:2026-11-23");
  });
});

describe("securityHeaders", () => {
  it("includes a CSP covering YouTube, fonts and frame-ancestors 'none'", () => {
    const headers = securityHeaders();
    assert.ok(headers["Content-Security-Policy"].includes("https://www.youtube.com"));
    assert.ok(headers["Content-Security-Policy"].includes("https://fonts.googleapis.com"));
    assert.ok(headers["Content-Security-Policy"].includes("https://fonts.gstatic.com"));
    assert.ok(headers["Content-Security-Policy"].includes("frame-ancestors 'none'"));
    assert.ok(headers["Content-Security-Policy"].includes("https://i.ytimg.com"));
  });

  it("includes the standard hardening headers", () => {
    const headers = securityHeaders();
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.ok(headers["Permissions-Policy"].includes("camera=()"));
    assert.ok(headers["Strict-Transport-Security"].includes("max-age=31536000"));
  });

  it("withSecurityHeaders merges headers into a new Response", async () => {
    const original = new Response("hello", {
      status: 200,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
    const wrapped = withSecurityHeaders(original);
    assert.equal(wrapped.status, 200);
    assert.equal(wrapped.headers.get("Content-Type"), "text/plain");
    assert.equal(wrapped.headers.get("Cache-Control"), "no-store");
    assert.equal(wrapped.headers.get("X-Frame-Options"), "DENY");
    assert.ok(wrapped.headers.get("Content-Security-Policy").includes("default-src 'self'"));
    assert.equal(await wrapped.text(), "hello");
  });
});

describe("timingSafeEqual", () => {
  it("returns true for equal strings", () => {
    assert.equal(timingSafeEqual("abc", "abc"), true);
    assert.equal(timingSafeEqual("", ""), true);
    assert.equal(timingSafeEqual("AniDoa-2026-Secret!", "AniDoa-2026-Secret!"), true);
  });

  it("returns false for unequal strings", () => {
    assert.equal(timingSafeEqual("abc", "abd"), false);
    assert.equal(timingSafeEqual("abc", "abcd"), false);
    assert.equal(timingSafeEqual("abcd", "abc"), false);
    assert.equal(timingSafeEqual("", "a"), false);
  });

  it("returns false for non-string input", () => {
    assert.equal(timingSafeEqual(null, "a"), false);
    assert.equal(timingSafeEqual("a", undefined), false);
    assert.equal(timingSafeEqual(123, 123), false);
  });
});

describe("getClientIp", () => {
  function fakeRequest(headers) {
    return { headers: new Headers(headers) };
  }

  it("prefers CF-Connecting-IP", () => {
    assert.equal(
      getClientIp(fakeRequest({ "CF-Connecting-IP": "1.2.3.4", "X-Forwarded-For": "5.6.7.8" })),
      "1.2.3.4"
    );
  });

  it("falls back to the first X-Forwarded-For entry", () => {
    assert.equal(getClientIp(fakeRequest({ "X-Forwarded-For": "5.6.7.8, 9.9.9.9" })), "5.6.7.8");
  });

  it("returns 'unknown' when no IP headers exist", () => {
    assert.equal(getClientIp(fakeRequest({})), "unknown");
    assert.equal(getClientIp(null), "unknown");
    assert.equal(getClientIp({}), "unknown");
  });
});
