/**
 * Explorer Agent
 * Real tool calls to arXiv and OpenAlex APIs.
 * Per-API timeout (10s) + retry with exponential backoff.
 * Disk cache by query hash.
 * On API failure: continues with remaining sources + emits degraded-mode event.
 */

import { cachedFetch } from "../cache";
import { PaperSchema, type Paper } from "../schemas";
import type { Emitter } from "../sse";

const API_TIMEOUT = 10_000;

// ── arXiv ─────────────────────────────────────────────────────────────────────

async function fetchArxiv(query: string, maxResults = 8): Promise<Paper[]> {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", "relevance");

  const res = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT) });
  if (!res.ok) throw new Error(`arXiv ${res.status}`);

  const xml = await res.text();
  return parseArxivXml(xml);
}

function parseArxivXml(xml: string): Paper[] {
  const papers: Paper[] = [];
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? [];

  for (const entry of entries) {
    const id = extract(entry, "id") ?? "";
    const arxivId = id.split("/abs/")[1]?.trim() ?? id;
    const title = extract(entry, "title")?.replace(/\s+/g, " ").trim() ?? "";
    const summary = extract(entry, "summary")?.replace(/\s+/g, " ").trim();
    const published = extract(entry, "published") ?? "";
    const year = published ? parseInt(published.slice(0, 4)) : undefined;

    const authorMatches = entry.match(/<name>(.*?)<\/name>/g) ?? [];
    const authors = authorMatches.map((a) =>
      a.replace(/<\/?name>/g, "").trim()
    );

    const doi =
      entry.match(/doi\.org\/([^<"]+)/)?.[1]?.trim() ?? undefined;

    const parsed = PaperSchema.safeParse({
      id: `arxiv:${arxivId}`,
      title,
      authors,
      year,
      abstract: summary,
      doi,
      url: id,
      source: "arxiv",
    });

    if (parsed.success && parsed.data.title) {
      papers.push(parsed.data);
    }
  }

  return papers;
}

function extract(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1] : undefined;
}

// ── OpenAlex ──────────────────────────────────────────────────────────────────

async function fetchOpenAlex(query: string, perPage = 8): Promise<Paper[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(perPage));
  url.searchParams.set("select", "id,title,authorships,publication_year,abstract_inverted_index,doi,primary_location");
  url.searchParams.set("mailto", "provenance-app@example.com"); // polite pool

  const res = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT) });
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);

  const data = await res.json();
  const results = data?.results ?? [];

  return results
    .map((r: Record<string, unknown>) => {
      const authors = ((r.authorships as Array<{ author: { display_name: string } }>) ?? [])
        .map((a) => a?.author?.display_name ?? "")
        .filter(Boolean);

      const abstract = reconstructAbstract(r.abstract_inverted_index as Record<string, number[]> | null);

      const parsed = PaperSchema.safeParse({
        id: `openalex:${r.id}`,
        title: r.title ?? "",
        authors,
        year: r.publication_year ?? undefined,
        abstract,
        doi: r.doi?.replace("https://doi.org/", "") ?? undefined,
        url: (r.primary_location as { landing_page_url?: string } | null)?.landing_page_url ?? r.id as string,
        source: "openalex",
      });

      return parsed.success ? parsed.data : null;
    })
    .filter((p: Paper | null): p is Paper => p !== null && !!p.title);
}

function reconstructAbstract(
  invertedIndex: Record<string, number[]> | null
): string | undefined {
  if (!invertedIndex) return undefined;
  const wordPositions: [string, number][] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      wordPositions.push([word, pos]);
    }
  }
  wordPositions.sort((a, b) => a[1] - b[1]);
  return wordPositions.map(([w]) => w).join(" ");
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastErr;
}

// ── Explorer entry point ──────────────────────────────────────────────────────

export async function runExplorer(
  subQuestion: string,
  explorerIndex: 1 | 2 | 3,
  emit: Emitter
): Promise<Paper[]> {
  const agent = `explorer-${explorerIndex}` as const;
  emit({ agent, status: "started", input_summary: subQuestion });

  const results: Paper[] = [];
  const cacheKey = `arxiv:${subQuestion}`;
  const cacheKeyOA = `openalex:${subQuestion}`;

  // arXiv
  emit({ agent, status: "tool_call", tool_call: "arxiv_search", input_summary: subQuestion });
  try {
    const { data, stale } = await cachedFetch(cacheKey, () =>
      withRetry(() => fetchArxiv(subQuestion))
    );
    results.push(...data);
    emit({
      agent,
      status: "result",
      tool_call: "arxiv_search",
      result_summary: `${data.length} papers${stale ? " (stale cache)" : ""}`,
    });
  } catch (err) {
    emit({
      agent,
      status: "degraded",
      tool_call: "arxiv_search",
      result_summary: `arXiv failed: ${String(err)}`,
    });
  }

  // OpenAlex
  emit({ agent, status: "tool_call", tool_call: "openalex_search", input_summary: subQuestion });
  try {
    const { data, stale } = await cachedFetch(cacheKeyOA, () =>
      withRetry(() => fetchOpenAlex(subQuestion))
    );
    results.push(...data);
    emit({
      agent,
      status: "result",
      tool_call: "openalex_search",
      result_summary: `${data.length} papers${stale ? " (stale cache)" : ""}`,
    });
  } catch (err) {
    emit({
      agent,
      status: "degraded",
      tool_call: "openalex_search",
      result_summary: `OpenAlex failed: ${String(err)}`,
    });
  }

  emit({
    agent,
    status: "done",
    result_summary: `${results.length} total candidate papers`,
  });

  return results;
}
