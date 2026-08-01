// A sliding-window limiter for credential endpoints.
//
// Login was the one route where an attacker got unlimited free guesses: bcrypt makes each
// attempt expensive for us and cheap for them, and nothing counted. This counts.
//
// In-memory on purpose. The API is a single container (see docker-compose.yml), so a Map is
// the whole truth; a restart forgives everyone, which is an acceptable trade for zero moving
// parts. // ponytail: move the counters to Postgres or Redis the day the API runs replicated.
//
// Pure apart from the clock, which is injectable — that's what makes it testable without
// sleeping through a real window.

export type Verdict = { ok: true } | { ok: false; retryAfterMs: number };

export type Limiter = {
  /** Would this key be allowed another attempt right now? */
  check(key: string, now?: number): Verdict;
  /** Record a failed attempt. Successes must not count, or a busy legitimate user locks out. */
  fail(key: string, now?: number): void;
  /** Check and record in one step, for limits where *every* request counts rather than only
   *  the failures — the public read routes, where the request itself is the cost. A rejected
   *  request is not recorded, so a client that keeps hammering a closed window doesn't push
   *  its own reopening further away. */
  hit(key: string, now?: number): Verdict;
  /** Forget a key — called on a successful login, so one typo never lingers. */
  reset(key: string): void;
  /** Live key count, for tests and the eviction bound. */
  size(): number;
};

export function createLimiter({
  limit,
  windowMs,
  maxKeys = 10_000,
}: {
  limit: number;
  windowMs: number;
  /** Bound on distinct keys held, so a spray of unique emails can't grow the map forever. */
  maxKeys?: number;
}): Limiter {
  const hits = new Map<string, number[]>();

  /** Drop timestamps that have aged out; returns what's left. */
  const live = (key: string, now: number): number[] => {
    const kept = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);
    return kept;
  };

  // Declared as functions rather than object methods so `hit` can call them without `this`,
  // which would break the moment a caller destructured the limiter.
  const check = (key: string, now = Date.now()): Verdict => {
    const recent = live(key, now);
    if (recent.length < limit) return { ok: true };
    // The window frees up when the oldest attempt in it ages out.
    return { ok: false, retryAfterMs: Math.max(1, windowMs - (now - recent[0])) };
  };

  const fail = (key: string, now = Date.now()): void => {
    const recent = live(key, now);
    recent.push(now);
    hits.set(key, recent);

    if (hits.size > maxKeys) {
      // Sweep the expired first; only if that isn't enough, evict in insertion order.
      for (const k of [...hits.keys()]) live(k, now);
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next();
        if (oldest.done) break;
        hits.delete(oldest.value);
      }
    }
  };

  return {
    check,
    fail,

    hit(key, now = Date.now()) {
      const verdict = check(key, now);
      if (verdict.ok) fail(key, now);
      return verdict;
    },

    reset(key) {
      hits.delete(key);
    },

    size() {
      return hits.size;
    },
  };
}
