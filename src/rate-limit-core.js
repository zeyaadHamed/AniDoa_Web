/**
 * AniDoa — rate-limit-core.js
 * Pure quota decisions shared by the Durable Object and Node tests.
 */

export function getRateLimitDecision(ipCount, globalCount, options) {
  const config = options || {};
  const ipLimit = Number.isFinite(config.ipLimit) && config.ipLimit > 0 ? config.ipLimit : 15;
  const dailyLimit =
    Number.isFinite(config.dailyLimit) && config.dailyLimit > 0 ? config.dailyLimit : 500;
  const now = config.now instanceof Date ? config.now : new Date(config.now || Date.now());

  if (Number.isNaN(now.getTime())) {
    throw new TypeError("A valid date is required for rate-limit decisions.");
  }

  const secondsUntilHourEnd = Math.max(
    1,
    3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds())
  );
  const secondsUntilDayEnd = Math.max(
    1,
    86400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds())
  );

  if (Number(ipCount) >= ipLimit) {
    return { allowed: false, scope: "ip", retryAfter: secondsUntilHourEnd };
  }
  if (Number(globalCount) >= dailyLimit) {
    return { allowed: false, scope: "global", retryAfter: secondsUntilDayEnd };
  }
  return { allowed: true, scope: null, retryAfter: 0 };
}

export function getRateLimitBuckets(date) {
  const now = date instanceof Date ? date : new Date(date === undefined ? Date.now() : date);
  if (Number.isNaN(now.getTime())) {
    throw new TypeError("A valid date is required for rate-limit buckets.");
  }
  return {
    hour: now.toISOString().slice(0, 13),
    day: now.toISOString().slice(0, 10),
  };
}
