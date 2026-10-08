/**
 * Disk cache for API results keyed by SHA-256 of the query string.
 * Cache dir: os.tmpdir()/provenance-cache/
 * TTL: 24 hours (stale entries are served on API failure = resilience mode).
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CACHE_DIR = join(tmpdir(), "provenance-cache");
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

function ensureDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function key(query: string): string {
  return createHash("sha256").update(query).digest("hex");
}

function filePath(k: string): string {
  return join(CACHE_DIR, `${k}.json`);
}

export function cacheGet<T>(query: string): T | null {
  ensureDir();
  const fp = filePath(key(query));
  if (!existsSync(fp)) return null;
  try {
    const stat = statSync(fp);
    const age = Date.now() - stat.mtimeMs;
    if (age > TTL_MS) return null; // expired — let caller try fresh
    const raw = readFileSync(fp, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function cacheSet<T>(query: string, data: T): void {
  ensureDir();
  const fp = filePath(key(query));
  try {
    writeFileSync(fp, JSON.stringify(data), "utf-8");
  } catch {
    // cache write failure is non-fatal
  }
}

/**
 * Wraps an async fetcher with cache-aside semantics.
 * On fetcher failure, falls back to stale cache (even if expired) and returns it.
 * If no cache at all, re-throws the original error.
 */
export async function cachedFetch<T>(
  query: string,
  fetcher: () => Promise<T>
): Promise<{ data: T; fromCache: boolean; stale: boolean }> {
  const fresh = cacheGet<T>(query);
  if (fresh !== null) {
    return { data: fresh, fromCache: true, stale: false };
  }
  try {
    const data = await fetcher();
    cacheSet(query, data);
    return { data, fromCache: false, stale: false };
  } catch (err) {
    // Try stale (expired) cache as fallback
    const fp = filePath(key(query));
    if (existsSync(fp)) {
      try {
        const raw = readFileSync(fp, "utf-8");
        const data = JSON.parse(raw) as T;
        return { data, fromCache: true, stale: true };
      } catch {
        /* fall through */
      }
    }
    throw err;
  }
}
