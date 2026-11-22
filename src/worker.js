import { DurableObject } from "cloudflare:workers";
import { getRateLimitBuckets, getRateLimitDecision } from "./rate-limit-core.js";

/**
 * AniDoa translation budget.
 *
 * A single named SQLite-backed Durable Object serializes counter changes in
 * transactions. This avoids KV's eventual-consistency/read-modify-write race
 * and keeps rate-limit writes out of the production ANIDOA_KV namespace.
 */
export class AniDoaRateLimiter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS ip_hour_limits (
        ip TEXT NOT NULL,
        bucket TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ip, bucket)
      );
      CREATE TABLE IF NOT EXISTS global_day_limits (
        bucket TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0
      );`
    );
  }

  checkAndIncrement(ip, nowIso, ipLimit, dailyLimit) {
    const now = new Date(nowIso);
    const buckets = getRateLimitBuckets(now);
    const safeIp = typeof ip === "string" && ip.trim() ? ip.trim().slice(0, 96) : "unknown";
    const sql = this.ctx.storage.sql;

    return this.ctx.storage.transactionSync(() => {
      // Keep only the current hour/day buckets so this database stays small.
      sql.exec("DELETE FROM ip_hour_limits WHERE bucket < ?", buckets.hour);
      sql.exec("DELETE FROM global_day_limits WHERE bucket < ?", buckets.day);

      const ipRows = sql
        .exec("SELECT count FROM ip_hour_limits WHERE ip = ? AND bucket = ?", safeIp, buckets.hour)
        .toArray();
      const globalRows = sql
        .exec("SELECT count FROM global_day_limits WHERE bucket = ?", buckets.day)
        .toArray();

      const ipCount = ipRows.length ? Number(ipRows[0].count) : 0;
      const globalCount = globalRows.length ? Number(globalRows[0].count) : 0;
      const decision = getRateLimitDecision(ipCount, globalCount, {
        ipLimit,
        dailyLimit,
        now,
      });

      if (!decision.allowed) return decision;

      sql.exec(
        `INSERT INTO ip_hour_limits (ip, bucket, count)
         VALUES (?, ?, 1)
         ON CONFLICT(ip, bucket) DO UPDATE SET count = count + 1`,
        safeIp,
        buckets.hour
      );
      sql.exec(
        `INSERT INTO global_day_limits (bucket, count)
         VALUES (?, 1)
         ON CONFLICT(bucket) DO UPDATE SET count = count + 1`,
        buckets.day
      );

      return decision;
    });
  }
}

import app from "./index.js";

export default app;
