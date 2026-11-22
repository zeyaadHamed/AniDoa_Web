import test from "node:test";
import assert from "node:assert/strict";

import { getRateLimitBuckets, getRateLimitDecision } from "../src/rate-limit-core.js";

test("allows translations below both limits", () => {
  assert.deepEqual(
    getRateLimitDecision(14, 499, {
      ipLimit: 15,
      dailyLimit: 500,
      now: new Date("2026-11-23T11:30:00.000Z"),
    }),
    { allowed: true, scope: null, retryAfter: 0 }
  );
});

test("blocks an IP at 15 translations in the current UTC hour", () => {
  const result = getRateLimitDecision(15, 10, {
    ipLimit: 15,
    dailyLimit: 500,
    now: new Date("2026-11-23T11:30:00.000Z"),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.scope, "ip");
  assert.equal(result.retryAfter, 1800);
});

test("blocks the platform at 500 translations in the current UTC day", () => {
  const result = getRateLimitDecision(0, 500, {
    ipLimit: 15,
    dailyLimit: 500,
    now: new Date("2026-11-23T11:30:00.000Z"),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.scope, "global");
  assert.equal(result.retryAfter, 45000);
});

test("uses UTC hour and day buckets", () => {
  assert.deepEqual(getRateLimitBuckets(new Date("2026-11-23T01:23:45.000Z")), {
    hour: "2026-11-23T01",
    day: "2026-11-23",
  });
});

test("rejects invalid dates", () => {
  assert.throws(() => getRateLimitBuckets("not-a-date"), /valid date/i);
  assert.throws(() => getRateLimitDecision(0, 0, { now: "not-a-date" }), /valid date/i);
});
