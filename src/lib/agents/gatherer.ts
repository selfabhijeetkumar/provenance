/**
 * Gatherer Agent
 * 1. Deduplicates papers (by DOI then by normalized title+year)
 * 2. LLM: extracts 2-4 key claims per paper
 * 3. Builds evidence table: { claims[], papers[] }
 */

import { chatWithRetry } from "../gemini";
import { geminiSemaphore } from "../semaphore";
import {
  ClaimsExtractionSchema,
  EvidenceTableSchema,
  type Claim,
  type EvidenceTable,
  type Paper,
} from "../schemas";
import type { Emitter } from "../sse";

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

async function extractClaimsForPaper(
  paper: Paper,
  emit: Emitter
): Promise<Claim[]> {
  if (!paper.abstract) return [];

  const prompt = `Extract 2-4 key factual claims from this research paper abstract. Each claim should be a single specific finding or contribution.

Paper ID: ${paper.id}
Title: ${paper.title}
Abstract: ${paper.abstract}

Return ONLY valid JSON:
{
  "claims": [
    { "claimId": "${paper.id}:1", "claim": "specific factual claim" },
    { "claimId": "${paper.id}:2", "claim": "another claim" }
  ]
}`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await geminiSemaphore.run(() =>
        chatWithRetry(
          [{ role: "user", content: prompt }],
          { jsonMode: true, temperature: 0.1 }
        )
      );
      const parsed = JSON.parse(raw);
      const result = ClaimsExtractionSchema.parse(parsed);

      return result.claims.map((c) => ({
        claimId: c.claimId,
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
  emit: Emitter
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

  // Step 2: filter to papers with abstracts (needed for claims)
  const withAbstract = papers.filter((p) => p.abstract && p.abstract.length > 50);

  // Limit to 15 papers to keep LLM calls reasonable in a 4-hour hackathon scope
  const selected = withAbstract.slice(0, 15);

  emit({
    agent: "gatherer",
    status: "tool_call",
    tool_call: "llm_claim_extraction",
    input_summary: `Extracting claims from ${selected.length} papers`,
  });

  // Extract claims in batches of 3 to respect semaphore
  const allClaims: Claim[] = [];
  for (let i = 0; i < selected.length; i += 3) {
    const batch = selected.slice(i, i + 3);
    const batchClaims = await Promise.all(
      batch.map((p) => extractClaimsForPaper(p, emit))
    );
    allClaims.push(...batchClaims.flat());
  }

  const table = EvidenceTableSchema.parse({ claims: allClaims, papers });

  emit({
    agent: "gatherer",
    status: "done",
    result_summary: `${allClaims.length} claims extracted from ${selected.length} papers`,
  });

  return table;
}
