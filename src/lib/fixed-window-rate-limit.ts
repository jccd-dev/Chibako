interface Bucket {
  count: number;
  startedAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function createFixedWindowRateLimiter(limit: number, windowMs: number, maxBuckets = 1024) {
  const buckets = new Map<string, Bucket>();

  function prune(timestamp: number) {
    for (const [key, bucket] of buckets) {
      if (timestamp - bucket.startedAt >= windowMs) buckets.delete(key);
    }
  }

  function blocked(key: string, timestamp = Date.now()): RateLimitResult {
    prune(timestamp);
    const bucket = buckets.get(key);
    if (!bucket || bucket.count < limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + windowMs - timestamp) / 1000)) };
  }

  function consume(key: string, timestamp = Date.now()): RateLimitResult {
    const status = blocked(key, timestamp);
    if (!status.allowed) return status;
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= maxBuckets) buckets.delete(buckets.keys().next().value!);
      bucket = { count: 0, startedAt: timestamp };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return { blocked, consume, reset: () => buckets.clear() };
}
