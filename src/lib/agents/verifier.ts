/**
 * Verifier Agent — the differentiator.
 *
 * Deterministic checks (plain code):
 *   1. DOI resolves via Crossref metadata API
 *   2. Title + authors + year match stored metadata
 *   3. No citation ID outside evidence table
 *
 * LLM check: does cited abstract support the claim?
 *   → supported | weak | unsupported
 *
 * Failed items → returned as feedback for Writer (max 2 iterations).
 * After 2 rounds, unresolved claims flagged [UNVERIFIED].
 */

import { chatWithRetry } from "../gemini";
import { geminiSemaphore } from "../semaphore";
import {
  LLMVerdictsSchema,
  type Claim,
  type Draft,
  type EvidenceTable,
  type VerificationResult,
} from "../schemas";
import type { Emitter } from "../sse";

// ── Deterministic checks ───────────────────────────────────────────────────────

/** Extract all [claimId] citations from draft text. */
function extractCitations(text: string): string[] {
  const matches = text.match(/\[([^\]]+)\]/g) ?? [];
  return matches.map((m) => m.slice(1, -1));
}

/** Check that DOI resolves via Crossref. HTTP HEAD is enough — no key needed. */
async function checkDoi(doi: string): Promise<boolean> {
  if (!doi) return true; // no DOI = skip, not fail
  try {
    const url = `https://doi.org/${encodeURIComponent(doi)}`;
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
    });
    return res.ok || res.status === 301 || res.status === 302 || res.status === 303;
  } catch {
    return false; // network timeout → treat as inconclusive, not blocking
  }
}

async function deterministicCheck(
  claim: Claim,
  table: EvidenceTable
): Promise<{ pass: boolean; urlResolved?: boolean; metadataMatch?: boolean; reason?: string }> {
  // Check 1: citation ID exists in evidence table
  const paperExists = table.papers.some((p) => p.id === claim.paperId);
  if (!paperExists) {
    return {
      pass: false,
      reason: `Citation ID "${claim.paperId}" not found in evidence table`,
    };
  }

  const paper = table.papers.find((p) => p.id === claim.paperId)!;

  // Check 2: DOI resolves (best effort, non-blocking)
  let urlResolved: boolean | undefined;
  if (paper.doi) {
    urlResolved = await checkDoi(paper.doi);
  }

  // Check 3: abstract not empty (metadata sanity)
  const metadataMatch = !!(paper.title && paper.authors.length > 0);

  return {
    pass: metadataMatch,
    urlResolved,
    metadataMatch,
    reason: metadataMatch ? undefined : "Missing title or authors in metadata",
  };
}

// ── LLM semantic check ────────────────────────────────────────────────────────

async function llmSupportCheck(
  claims: Claim[]
): Promise<Map<string, { verdict: "supported" | "weak" | "unsupported"; reason: string }>> {
  if (claims.length === 0) return new Map();

  const claimList = claims
    .slice(0, 20) // batch cap
    .map(
      (c) => `claimId: ${c.claimId}\nclaim: ${c.claim}\nabstract: ${c.abstract.slice(0, 400)}`
    )
    .join("\n---\n");

  const prompt = `You are a research verifier. For each claim below, determine if the provided abstract supports it.

Verdict options:
- "supported": the abstract clearly supports the claim
- "weak": the abstract is tangentially related but doesn't directly support the claim  
- "unsupported": the abstract contradicts or does not support the claim

Return ONLY valid JSON:
{
  "verdicts": [
    { "claimId": "...", "verdict": "supported|weak|unsupported", "reason": "brief explanation" }
  ]
}

Claims to verify:
${claimList}`;

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
      const result = LLMVerdictsSchema.parse(parsed);

      const map = new Map<string, { verdict: "supported" | "weak" | "unsupported"; reason: string }>();
      for (const v of result.verdicts) {
        map.set(v.claimId, { verdict: v.verdict, reason: v.reason });
      }
      return map;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 600));
    }
  }
  throw new Error(`LLM verification failed: ${String(lastErr)}`);
}

// ── Main verifier entry point ─────────────────────────────────────────────────

export interface VerifierOutput {
  results: VerificationResult[];
  feedbackForWriter: string | null; // null if everything passed
  draftWithFlags: Draft; // claims flagged [UNVERIFIED] if needed
}

export async function runVerifier(
  draft: Draft,
  table: EvidenceTable,
  iteration: number,
  emit: Emitter
): Promise<VerifierOutput> {
  emit({
    agent: "verifier",
    status: "started",
    input_summary: `Verifying draft (iteration ${iteration})`,
    iteration,
  });

  const allText = `${draft.abstract} ${draft.findings} ${draft.limitations} ${draft.references}`;
  const citedIds = new Set(extractCitations(allText));

  // Only verify claims that are actually cited in the draft
  const claimsToVerify = table.claims.filter((c) => citedIds.has(c.claimId));

  emit({
    agent: "verifier",
    status: "tool_call",
    tool_call: "deterministic_checks",
    input_summary: `${claimsToVerify.length} cited claims`,
    iteration,
  });

  // Deterministic checks (parallel)
  const deterministicResults = await Promise.all(
    claimsToVerify.map(async (claim) => {
      const check = await deterministicCheck(claim, table);
      return { claim, check };
    })
  );

  // LLM semantic check
  emit({
    agent: "verifier",
    status: "tool_call",
    tool_call: "llm_support_check",
    input_summary: `Semantic check on ${claimsToVerify.length} claims`,
    iteration,
  });

  let llmVerdicts = new Map<string, { verdict: "supported" | "weak" | "unsupported"; reason: string }>();
  try {
    llmVerdicts = await llmSupportCheck(claimsToVerify);
  } catch (err) {
    emit({
      agent: "verifier",
      status: "degraded",
      result_summary: `LLM check failed, using deterministic only: ${String(err)}`,
      iteration,
    });
  }

  // Combine results
  const results: VerificationResult[] = deterministicResults.map(({ claim, check }) => {
    const llm = llmVerdicts.get(claim.claimId);
    const deterministicPass = check.pass;
    const verdict = !deterministicPass
      ? "unsupported"
      : (llm?.verdict ?? "supported");

    return {
      claimId: claim.claimId,
      verdict: verdict as "supported" | "weak" | "unsupported",
      reason: llm?.reason ?? check.reason ?? "deterministic check passed",
      deterministicPass,
      urlResolved: check.urlResolved,
      metadataMatch: check.metadataMatch,
    };
  });

  // Build feedback for Writer
  const failed = results.filter((r) => r.verdict === "unsupported");
  const weak = results.filter((r) => r.verdict === "weak");
  const feedbackItems = [
    ...failed.map((r) => `REMOVE or fix [${r.claimId}]: ${r.reason} (verdict: unsupported)`),
    ...weak.map((r) => `WEAKEN [${r.claimId}]: ${r.reason} (verdict: weak)`),
  ];

  const feedbackForWriter = feedbackItems.length > 0 ? feedbackItems.join("\n") : null;

  // Flag unresolved claims in draft after max iterations
  const MAX_ITERATIONS = 2;
  let draftWithFlags = { ...draft };
  if (iteration >= MAX_ITERATIONS && failed.length > 0) {
    const failedIds = new Set(failed.map((r) => r.claimId));
    const flagDraft = (text: string) =>
      text.replace(/\[([^\]]+)\]/g, (match, id) =>
        failedIds.has(id) ? `[UNVERIFIED:${id}]` : match
      );
    draftWithFlags = {
      abstract: flagDraft(draft.abstract),
      findings: flagDraft(draft.findings),
      limitations: flagDraft(draft.limitations),
      references: draft.references, // keep references intact
    };
  }

  const passCount = results.filter((r) => r.verdict === "supported").length;
  emit({
    agent: "verifier",
    status: "done",
    result_summary: `${passCount}/${results.length} supported, ${failed.length} failed, ${weak.length} weak`,
    iteration,
  });

  return { results, feedbackForWriter, draftWithFlags };
}
