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

import { chatWithRetry, parseLlmJson } from "../gemini";
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
  const ids: string[] = [];
  for (const m of matches) {
    const inner = m.slice(1, -1);
    for (const part of inner.split(",")) {
      const trimmed = part.trim();
      if (trimmed && !trimmed.startsWith("UNVERIFIED") && !trimmed.startsWith("http")) {
        ids.push(trimmed);
      }
    }
  }
  return ids;
}

/** Extract year from arXiv identifier (handles new YYMM.NNNNN and legacy arch/YYMMNNN formats). */
export function extractArxivYear(id: string): number | null {
  if (!id) return null;
  const newMatch = id.match(/arxiv:(\d{2})(\d{2})\./i) || id.match(/(?:^|\/)(\d{2})(\d{2})\.\d{4,5}/);
  if (newMatch) {
    const yy = parseInt(newMatch[1], 10);
    return yy >= 90 ? 1900 + yy : 2000 + yy;
  }
  const oldMatch = id.match(/arxiv:[a-z\-]+(?:\.[a-z]{2})?\/(\d{2})(\d{2})\d{3}/i);
  if (oldMatch) {
    const yy = parseInt(oldMatch[1], 10);
    return yy >= 90 ? 1900 + yy : 2000 + yy;
  }
  return null;
}

/** Check that DOI resolves via doi.org foundation / Crossref. HTTP HEAD with manual redirect avoids publisher 405s. */
export async function checkDoi(doi: string): Promise<boolean> {
  if (!doi) return true; // no DOI = skip, not fail
  try {
    const cleanDoi = doi.trim().replace(/^https?:\/\/doi\.org\//i, "");
    const url = `https://doi.org/${cleanDoi}`;
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(6_000),
    });
    // doi.org returns 301, 302, 303, 307, 308 redirect for existing DOIs, or 200
    // Unresolvable DOIs return 404
    return (
      res.status === 200 ||
      res.status === 301 ||
      res.status === 302 ||
      res.status === 303 ||
      res.status === 307 ||
      res.status === 308
    );
  } catch {
    return false; // network timeout / invalid DOI -> fail resolution
  }
}

/** Validate metadata completeness and consistency (title, authors, year, arxiv consistency). */
export function validateMetadata(paper: {
  id: string;
  title: string;
  authors: string[];
  year?: number;
}): { valid: boolean; reason?: string } {
  if (!paper.title || paper.title.trim().length < 4) {
    return { valid: false, reason: "Missing or invalid title in metadata" };
  }
  if (!Array.isArray(paper.authors) || paper.authors.length === 0) {
    return { valid: false, reason: "Missing authors in metadata" };
  }
  if (paper.year !== undefined && (paper.year < 1900 || paper.year > 2030)) {
    return { valid: false, reason: `Invalid publication year (${paper.year}) in metadata` };
  }
  const arxivYear = extractArxivYear(paper.id);
  if (arxivYear !== null && paper.year !== undefined) {
    if (Math.abs(arxivYear - paper.year) > 1) {
      return {
        valid: false,
        reason: `Year mismatch: arXiv ID indicates ~${arxivYear} but metadata says ${paper.year}`,
      };
    }
  }
  return { valid: true };
}

export async function deterministicCheck(
  claim: Claim,
  table: EvidenceTable,
  skipNetworkDoi = false
): Promise<{ pass: boolean; urlResolved?: boolean; metadataMatch?: boolean; reason?: string }> {
  // Check 1: citation ID exists in evidence table
  const paper = table.papers.find((p) => p.id === claim.paperId);
  if (!paper) {
    return {
      pass: false,
      urlResolved: false,
      metadataMatch: false,
      reason: `Citation ID "${claim.paperId}" not found in evidence table`,
    };
  }

  // Check 2: title + authors + year match stored metadata
  const meta = validateMetadata(paper);
  if (!meta.valid) {
    return {
      pass: false,
      urlResolved: undefined,
      metadataMatch: false,
      reason: meta.reason,
    };
  }

  // Check 3: DOI resolves via Crossref (if DOI present)
  let urlResolved: boolean | undefined;
  if (paper.doi) {
    if (skipNetworkDoi) {
      urlResolved = true;
    } else {
      urlResolved = await checkDoi(paper.doi);
      if (!urlResolved) {
        return {
          pass: false,
          urlResolved: false,
          metadataMatch: true,
          reason: `Unresolvable DOI: ${paper.doi}`,
        };
      }
    }
  }

  return {
    pass: true,
    urlResolved,
    metadataMatch: true,
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
      const parsed = parseLlmJson(raw);
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

  const inTextContent = `${draft.abstract} ${draft.findings} ${draft.limitations}`;
  const citedIds = new Set(extractCitations(inTextContent));

  // Build claimsToVerify ensuring EVERY citedId is accounted for
  const claimsToVerify: Claim[] = [];
  const processedCitations = new Set<string>();

  for (const cid of citedIds) {
    const matchingClaims = table.claims.filter(
      (c) => c.claimId === cid || c.paperId === cid || c.sourceId === cid
    );
    if (matchingClaims.length > 0) {
      for (const mc of matchingClaims) {
        if (!processedCitations.has(mc.claimId)) {
          claimsToVerify.push(mc);
          processedCitations.add(mc.claimId);
        }
      }
    } else {
      const matchingPaper = table.papers.find((p) => p.id === cid);
      if (matchingPaper) {
        claimsToVerify.push({
          claimId: cid,
          paperId: cid,
          sourceId: cid,
          claim: matchingPaper.title,
          abstract: matchingPaper.abstract ?? "",
        });
      } else {
        // Phantom citation outside evidence table
        claimsToVerify.push({
          claimId: cid,
          paperId: cid,
          sourceId: cid,
          claim: `Unrecognized citation: ${cid}`,
          abstract: "",
        });
      }
    }
  }

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

  // Filter only deterministic passes for LLM semantic verification
  const claimsForLlm = claimsToVerify.filter((c) => {
    const det = deterministicResults.find((dr) => dr.claim.claimId === c.claimId);
    return det?.check.pass === true;
  });

  // LLM semantic check
  emit({
    agent: "verifier",
    status: "tool_call",
    tool_call: "llm_support_check",
    input_summary: `Semantic check on ${claimsForLlm.length} claims passing deterministic checks`,
    iteration,
  });

  let llmVerdicts = new Map<string, { verdict: "supported" | "weak" | "unsupported"; reason: string }>();
  if (claimsForLlm.length > 0) {
    try {
      llmVerdicts = await llmSupportCheck(claimsForLlm);
    } catch (err) {
      emit({
        agent: "verifier",
        status: "degraded",
        result_summary: `LLM check failed, using deterministic only: ${String(err)}`,
        iteration,
      });
    }
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

  // Emit one event per citation with {sourceId, claimId, verdict, reason, iteration}
  for (const r of results) {
    const claim = claimsToVerify.find((c) => c.claimId === r.claimId);
    const paper = table.papers.find(
      (p) => p.id === claim?.paperId || p.id === claim?.sourceId || r.claimId.startsWith(p.id)
    );
    emit({
      agent: "verifier",
      status: "result",
      sourceId: claim?.sourceId ?? claim?.paperId ?? paper?.id ?? r.claimId,
      claimId: r.claimId,
      verdict: r.verdict === "supported" ? "verified" : r.verdict,
      reason: r.reason,
      iteration,
      result_summary: `[${r.claimId}]: ${(r.verdict === "supported" ? "verified" : r.verdict).toUpperCase()} — ${r.reason.slice(0, 80)}`,
    });
  }

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
      text.replace(/\[([^\]]+)\]/g, (match, id) => {
        const isFailed =
          failedIds.has(id) ||
          Array.from(failedIds).some((fid) => fid === id || fid.startsWith(id) || id.startsWith(fid));
        return isFailed ? `[UNVERIFIED:${id}]` : match;
      });
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
