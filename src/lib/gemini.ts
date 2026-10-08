/**
 * Gemini LLM client — OpenAI-compatible gateway.
 * All configuration comes from env vars (server-side only, never sent to browser).
 * Supports official Google Gemini API, local gemini-web2api, or any OpenAI-compatible endpoint.
 *
 * Required: GEMINI_BASE_URL, GEMINI_API_KEY, GEMINI_MODEL
 * Official Google endpoint: https://generativelanguage.googleapis.com/v1beta/openai
 */

const GEMINI_BASE = (process.env.GEMINI_BASE_URL ?? "").replace(/\/$/, "");
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

// Fast-fail status codes — retrying these wastes time, they need config fixes
const FAST_FAIL_STATUSES = new Set([401, 403, 405]);

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface GeminiOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export class GeminiError extends Error {
  constructor(public status: number, message: string) {
    super(`Gemini ${status}: ${message}`);
    this.name = "GeminiError";
  }
}

function friendlyError(status: number, text: string): string {
  if (status === 401 || status === 403) {
    return `upstream error: HTTP ${status} — check GEMINI_API_KEY is a valid Google AI Studio key`;
  }
  if (status === 405) {
    return `upstream error: HTTP 405 Method Not Allowed — GEMINI_BASE_URL may be wrong (use https://generativelanguage.googleapis.com/v1beta/openai for the official API)`;
  }
  if (status === 502 || status === 503 || status === 504) {
    return `upstream error: HTTP ${status} — gateway is down or unreachable; check GEMINI_BASE_URL`;
  }
  return `upstream error: HTTP ${status} ${text.slice(0, 200)}`;
}

/**
 * Single-turn completion via the OpenAI-compatible gateway.
 * Hard 30s timeout. Throws GeminiError on non-2xx with a friendly message.
 */
export async function chat(
  messages: ChatMessage[],
  opts: GeminiOptions = {}
): Promise<string> {
  if (!GEMINI_BASE) {
    throw new GeminiError(
      503,
      "GEMINI_BASE_URL is not set. Add it to .env.local (e.g. https://generativelanguage.googleapis.com/v1beta/openai)"
    );
  }

  const body: Record<string, unknown> = {
    model: GEMINI_MODEL,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 4096,
  };

  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  let res: Response;
  try {
    res = await fetch(`${GEMINI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GEMINI_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000), // hard 30s cap
    });
  } catch (err: unknown) {
    // Network-level failure (ECONNREFUSED, timeout, DNS)
    const msg =
      err instanceof Error ? err.message : String(err);
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
      throw new GeminiError(
        503,
        `gateway unreachable at ${GEMINI_BASE} — is the service running? (${msg})`
      );
    }
    if (msg.includes("TimeoutError") || msg.includes("timed out")) {
      throw new GeminiError(408, `request timed out after 30s — gateway may be overloaded`);
    }
    throw new GeminiError(503, msg);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new GeminiError(res.status, friendlyError(res.status, text));
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`Unexpected Gemini response shape: ${JSON.stringify(data)}`);
  }
  return content;
}

/**
 * chatWithRetry: wraps chat() with up to `maxAttempts` attempts.
 * - 429: exponential backoff (1s, 2s, 4s)
 * - Fast-fail codes (401, 403, 405): throw immediately, no retry
 * - 502/503/network: retry with backoff
 */
export async function chatWithRetry(
  messages: ChatMessage[],
  opts: GeminiOptions = {},
  maxAttempts = 3
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await chat(messages, opts);
    } catch (err) {
      lastErr = err;

      if (err instanceof GeminiError) {
        // Fast-fail: config problem, retrying won't help
        if (FAST_FAIL_STATUSES.has(err.status)) {
          throw err;
        }
        // 429: rate limited — exponential backoff
        if (err.status === 429) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 16_000);
          console.warn(`[gemini] 429 rate-limited, backoff ${delay}ms (attempt ${attempt}/${maxAttempts})`);
          await sleep(delay);
          continue;
        }
      }

      // Other errors: retry if attempts remain
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * gatewayHealthCheck: fires one tiny request at startup to verify the gateway is reachable.
 * Logs OK or FAIL to the server terminal. Never throws — failures are informational.
 */
export async function gatewayHealthCheck(): Promise<void> {
  if (!GEMINI_BASE) {
    console.warn("[gemini] HEALTH CHECK FAIL — GEMINI_BASE_URL is not set");
    return;
  }
  try {
    await chat(
      [{ role: "user", content: "ping" }],
      { temperature: 0, maxTokens: 1 }
    );
    console.log(`[gemini] HEALTH CHECK OK — gateway ${GEMINI_BASE} is reachable (model: ${GEMINI_MODEL})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[gemini] HEALTH CHECK FAIL — ${msg}`);
    console.warn(`[gemini]   Base URL : ${GEMINI_BASE}`);
    console.warn(`[gemini]   Model    : ${GEMINI_MODEL}`);
    console.warn(`[gemini]   Key set  : ${GEMINI_KEY ? "yes" : "NO — GEMINI_API_KEY is empty"}`);
  }
}

/**
 * Extracts and parses JSON from LLM responses, stripping any markdown
 * code fences (e.g. ```json ... ```) and extracting JSON objects or arrays.
 */
export function parseLlmJson<T = unknown>(raw: string): T {
  let cleaned = raw.trim();

  // Strip code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  // Find outermost JSON structure (object or array)
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");

  let start = -1;
  let end = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace;
    end = cleaned.lastIndexOf("}");
  } else if (firstBracket !== -1) {
    start = firstBracket;
    end = cleaned.lastIndexOf("]");
  }

  if (start !== -1 && end !== -1 && end >= start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  return JSON.parse(cleaned) as T;
}
