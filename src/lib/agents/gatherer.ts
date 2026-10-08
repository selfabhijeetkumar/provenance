/**
 * Gatherer Agent
 * 1. Deduplicates papers (by DOI then by normalized title+year)
 * 2. Ranks by topic relevance (keyword overlap — no LLM call needed)
 * 3. LLM: extracts exactly 2 key claims per paper (capped at 2 for speed)
 * 4. Builds evidence table: { claims[], papers[] }
 *
 * Cap: top 24 papers by relevance → up to 48 claims total.
 */

import { chatWithRetry, parseLlmJson } from "../gemini";
import { geminiSemaphore } from "../semaphore";
import {
  ClaimsExtractionSchema,
  EvidenceTableSchema,
  type Claim,
  type EvidenceTable,
  type Paper,
} from "../schemas";
import type { Emitter } from "../sse";

const MAX_PAPERS = 24;
const MAX_CLAIMS_PER_PAPER = 2;
const CLAIM_EXTRACTION_TIMEOUT = 20_000; // 20s per paper

function normTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Deterministic dedup: DOI wins; then title+year fingerprint. */
export function deduplicatePapers(papers: Paper[]): Paper[] {
  const seenDoi = new Set<string>();
  const seenFingerprint = new Set<string>();
  const unique: Paper[] = [];

  for (const paper of papers) {
    if (paper.doi) {
      const d = paper.doi.toLowerCase().trim();
      if (seenDoi.has(d)) continue;
      seenDoi.add(d);
    }
    const fp = `${normTitle(paper.title)}|${paper.year ?? ""}`;
    if (seenFingerprint.has(fp)) continue;
    seenFingerprint.add(fp);
    unique.push(paper);
  }

  return unique;
}

/**
 * Score a paper's relevance to a topic using keyword overlap.
 * No LLM needed — fast deterministic scoring.
 */
function relevanceScore(paper: Paper, topicTokens: Set<string>): number {
  const text = `${paper.title} ${paper.abstract ?? ""}`.toLowerCase();
  let score = 0;
  for (const tok of topicTokens) {
    if (text.includes(tok)) score++;
  }
  return score;
}

function tokenizeTopic(topic: string): Set<string> {
  const stopWords = new Set([
    "what", "which", "how", "why", "are", "the", "and", "for",
    "with", "from", "that", "this", "can", "does", "in", "of", "a",
    "an", "to", "on", "at", "by", "is", "it", "be", "as",
  ]);
  return new Set(
    topic
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
  );
}

async function extractClaimsForPaper(
  paper: Paper,
  emit: Emitter
): Promise<Claim[]> {
  if (!paper.abstract) return [];

  const prompt = `Extract exactly ${MAX_CLAIMS_PER_PAPER} key factual claims from this research paper abstract. Each claim must be a single specific finding or contribution that is directly supported by this abstract.

Paper ID: ${paper.id}
Title: ${paper.title}
Abstract: ${paper.abstract.slice(0, 1200)}

Return ONLY valid JSON:
{
  "claims": [
    { "claimId": "${paper.id}:1", "claim": "specific factual claim from abstract" },
    { "claimId": "${paper.id}:2", "claim": "another specific factual claim" }
  ]
}`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await geminiSemaphore.run(() =>
        Promise.race([
          chatWithRetry(
            [{ role: "user", content: prompt }],
            { jsonMode: true, temperature: 0.1 }
          ),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("claim extraction timeout")), CLAIM_EXTRACTION_TIMEOUT)
          ),
        ])
      );
      const parsed = parseLlmJson(raw);
      const result = ClaimsExtractionSchema.parse(parsed);

      return result.claims
        .slice(0, MAX_CLAIMS_PER_PAPER)
        .map((c, idx) => ({
          claimId: c.claimId && c.claimId.startsWith(paper.id) ? c.claimId : `${paper.id}:${idx + 1}`,
          claim: c.claim,
          sourceId: paper.id,
          paperId: paper.id,
          abstract: paper.abstract ?? "",
        }));
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
    }
  }

  emit({
    agent: "gatherer",
    status: "error",
    result_summary: `Claim extraction failed for ${paper.id}: ${String(lastErr)}`,
  });
  return [];
}

export async function runGatherer(
  allPapers: Paper[],
  emit: Emitter,
  topic = ""
): Promise<EvidenceTable> {
  emit({
    agent: "gatherer",
    status: "started",
    input_summary: `${allPapers.length} candidate papers`,
  });

  // Step 1: dedup
  const papers = deduplicatePapers(allPapers);
  emit({
    agent: "gatherer",
    status: "result",
    tool_call: "dedup",
    result_summary: `${papers.length} unique papers after dedup (was ${allPapers.length})`,
  });

  // Step 2: filter to papers with abstracts
  const withAbstract = papers.filter((p) => p.abstract && p.abstract.length > 50);

  // Step 3: rank by topic relevance (keyword scoring)
  const topicTokens = tokenizeTopic(topic);
  const ranked = topicTokens.size > 0
    ? [...withAbstract].sort((a, b) => relevanceScore(b, topicTokens) - relevanceScore(a, topicTokens))
    : withAbstract;

  // Take top MAX_PAPERS by relevance
  const selected = ranked.slice(0, MAX_PAPERS);

  emit({
    agent: "gatherer",
    status: "tool_call",
    tool_call: "llm_claim_extraction",
    input_summary: `Extracting ${MAX_CLAIMS_PER_PAPER} claims each from ${selected.length} top-relevance papers`,
  });

  // Extract claims in batches of 3 (semaphore cap = 3)
  const allClaims: Claim[] = [];
  for (let i = 0; i < selected.length; i += 3) {
    const batch = selected.slice(i, i + 3);
    const batchClaims = await Promise.all(
      batch.map((p) => extractClaimsForPaper(p, emit))
    );
    allClaims.push(...batchClaims.flat());

    emit({
      agent: "gatherer",
      status: "result",
      result_summary: `Batch ${Math.floor(i / 3) + 1}: ${batchClaims.flat().length} claims (total so far: ${allClaims.length})`,
    });
  }

  // EvidenceTable includes ALL deduplicated papers (not just selected) for reference completeness
  const table = EvidenceTableSchema.parse({ claims: allClaims, papers });

  emit({
    agent: "gatherer",
    status: "done",
    result_summary: `${allClaims.length} claims from ${selected.length} papers (${papers.length} total unique)`,
  });

  return table;
}
