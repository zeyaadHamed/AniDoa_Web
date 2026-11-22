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
      );
      CREATE TABLE IF NOT EXISTS active_translations (
        video_id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL
      );`
    );
  }

  claimTranslation(ip, videoId, nowIso, ipLimit, dailyLimit) {
    const now = new Date(nowIso);
    const buckets = getRateLimitBuckets(now);
    const nowMs = now.getTime();
    const safeIp = typeof ip === "string" && ip.trim() ? ip.trim().slice(0, 96) : "unknown";
    const safeVideoId = typeof videoId === "string" ? videoId.slice(0, 32) : "";
    const sql = this.ctx.storage.sql;

    return this.ctx.storage.transactionSync(() => {
      // Keep only the current hour/day buckets so this database stays small.
      sql.exec("DELETE FROM ip_hour_limits WHERE bucket < ?", buckets.hour);
      sql.exec("DELETE FROM global_day_limits WHERE bucket < ?", buckets.day);
      const staleBefore = new Date(nowMs - 5 * 60 * 1000).toISOString();
      sql.exec("DELETE FROM active_translations WHERE started_at < ?", staleBefore);

      // Prevent concurrent requests for the same episode from spending twice.
      const activeRows = sql
        .exec("SELECT started_at FROM active_translations WHERE video_id = ?", safeVideoId)
        .toArray();
      if (activeRows.length) {
        const startedAt = Date.parse(activeRows[0].started_at);
        if (Number.isFinite(startedAt) && nowMs - startedAt < 5 * 60 * 1000) {
          return { allowed: false, scope: "in_progress", retryAfter: 30 };
        }
        sql.exec("DELETE FROM active_translations WHERE video_id = ?", safeVideoId);
      }

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
      sql.exec(
        "INSERT INTO active_translations (video_id, started_at) VALUES (?, ?)",
        safeVideoId,
        now.toISOString()
      );

      return decision;
    });
  }

  releaseTranslation(videoId) {
    const safeVideoId = typeof videoId === "string" ? videoId.slice(0, 32) : "";
    this.ctx.storage.sql.exec("DELETE FROM active_translations WHERE video_id = ?", safeVideoId);
  }
}

import app from "./index.js";

export default app;
