/**
 * Gemini LLM client — reuses the local gemini-web2api gateway.
 * Base URL: http://127.0.0.1:8081/v1
 * Key: sk-gemini (server-side only, never sent to browser)
 */

const GEMINI_BASE = process.env.GEMINI_BASE_URL ?? "http://127.0.0.1:8081/v1";
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "sk-gemini";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface GeminiOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

/**
 * Single-turn completion via the OpenAI-compatible gateway.
 * Throws on non-2xx. Caller handles retry/backoff.
 */
export async function chat(
  messages: ChatMessage[],
  opts: GeminiOptions = {}
): Promise<string> {
  const body: Record<string, unknown> = {
    model: GEMINI_MODEL,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 4096,
  };

  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${GEMINI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GEMINI_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new GeminiError(res.status, text);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`Unexpected Gemini response shape: ${JSON.stringify(data)}`);
  }
  return content;
}

export class GeminiError extends Error {
  constructor(public status: number, message: string) {
    super(`Gemini ${status}: ${message}`);
    this.name = "GeminiError";
  }
}

/**
 * chatWithRetry: wraps chat() with up to `maxAttempts` attempts.
 * On 429 backs off exponentially. On malformed JSON (for jsonMode callers)
 * this is a transport-level retry — schema validation is the caller's job.
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
      if (err instanceof GeminiError && err.status === 429) {
        const delay = Math.min(1000 * 2 ** attempt, 16_000);
        await sleep(delay);
        continue;
      }
      // Non-429 errors: only retry if attempts remain
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
