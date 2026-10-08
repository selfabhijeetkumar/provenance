import type { Draft, EvidenceTable, VerificationResult } from "./schemas";

export interface VerificationReport {
  runId: string;
  topic: string;
  timestamp: string;
  citationsInDraft: string[];
  perCheckCounts: {
    inEvidenceTable: { pass: number; fail: number };
    doiResolves: { pass: number; fail: number; notApplicable: number };
    titleMatch: { pass: number; fail: number };
    authorMatch: { pass: number; fail: number };
    yearMatch: { pass: number; fail: number };
  };
  llmVerdictCounts: {
    supported: number;
    weak: number;
    unsupported: number;
  };
  topFailureReasons: Array<{ reason: string; count: number }>;
  summary: {
    totalCitationsInDraft: number;
    totalClaimsVerified: number;
    supportedCount: number;
    weakCount: number;
    unsupportedCount: number;
    verifiedPercentage: number;
    targetMet: boolean;
    unresolvedFlagged: boolean;
  };
}

export function extractCitationsFromDraft(draft: Draft): string[] {
  const inTextContent = `${draft.abstract} ${draft.findings} ${draft.limitations}`;
  const matches = inTextContent.match(/\[([^\]]+)\]/g) ?? [];
  const ids: string[] = [];
  for (const m of matches) {
    const inner = m.slice(1, -1);
    for (const part of inner.split(",")) {
      const trimmed = part.trim();
      if (
        trimmed &&
        !trimmed.startsWith("UNVERIFIED") &&
        !trimmed.startsWith("http") &&
        !trimmed.startsWith("✅") &&
        !trimmed.startsWith("⚠️") &&
        !trimmed.startsWith("❌")
      ) {
        ids.push(trimmed);
      }
    }
  }
  return Array.from(new Set(ids));
}

export function buildVerificationReport(
  runId: string,
  topic: string,
  draft: Draft,
  table: EvidenceTable,
  verificationResults: VerificationResult[]
): VerificationReport {
  const citationsInDraft = extractCitationsFromDraft(draft);

  const perCheckCounts = {
    inEvidenceTable: { pass: 0, fail: 0 },
    doiResolves: { pass: 0, fail: 0, notApplicable: 0 },
    titleMatch: { pass: 0, fail: 0 },
    authorMatch: { pass: 0, fail: 0 },
    yearMatch: { pass: 0, fail: 0 },
  };

  const llmVerdictCounts = {
    supported: 0,
    weak: 0,
    unsupported: 0,
  };

  const failureReasonsMap = new Map<string, number>();

  for (const r of verificationResults) {
    if (r.verdict === "supported") llmVerdictCounts.supported++;
    else if (r.verdict === "weak") llmVerdictCounts.weak++;
    else if (r.verdict === "unsupported") llmVerdictCounts.unsupported++;

    if (r.deterministicPass) {
      perCheckCounts.inEvidenceTable.pass++;
      perCheckCounts.titleMatch.pass++;
      perCheckCounts.authorMatch.pass++;
      perCheckCounts.yearMatch.pass++;
    } else {
      const reason = r.reason || "Deterministic check failed";
      failureReasonsMap.set(reason, (failureReasonsMap.get(reason) || 0) + 1);

      if (reason.includes("not found in evidence table")) {
        perCheckCounts.inEvidenceTable.fail++;
      } else {
        perCheckCounts.inEvidenceTable.pass++;
      }

      if (reason.includes("title")) {
        perCheckCounts.titleMatch.fail++;
      } else {
        perCheckCounts.titleMatch.pass++;
      }

      if (reason.includes("author")) {
        perCheckCounts.authorMatch.fail++;
      } else {
        perCheckCounts.authorMatch.pass++;
      }

      if (reason.includes("year") || reason.includes("Year mismatch")) {
        perCheckCounts.yearMatch.fail++;
      } else {
        perCheckCounts.yearMatch.pass++;
      }
    }

    if (r.urlResolved === true) {
      perCheckCounts.doiResolves.pass++;
    } else if (r.urlResolved === false) {
      perCheckCounts.doiResolves.fail++;
      failureReasonsMap.set("Unresolvable DOI", (failureReasonsMap.get("Unresolvable DOI") || 0) + 1);
    } else {
      perCheckCounts.doiResolves.notApplicable++;
    }

    if (r.verdict === "unsupported" && r.reason && r.deterministicPass) {
      failureReasonsMap.set(r.reason, (failureReasonsMap.get(r.reason) || 0) + 1);
    }
  }

  const topFailureReasons = Array.from(failureReasonsMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const totalVerified = llmVerdictCounts.supported;
  const totalChecked = verificationResults.length;
  const verifiedPercentage = totalChecked > 0 ? Math.round((totalVerified / totalChecked) * 100) : 0;
  const targetMet = citationsInDraft.length >= 10 && verifiedPercentage >= 70;

  return {
    runId,
    topic,
    timestamp: new Date().toISOString(),
    citationsInDraft,
    perCheckCounts,
    llmVerdictCounts,
    topFailureReasons,
    summary: {
      totalCitationsInDraft: citationsInDraft.length,
      totalClaimsVerified: totalChecked,
      supportedCount: llmVerdictCounts.supported,
      weakCount: llmVerdictCounts.weak,
      unsupportedCount: llmVerdictCounts.unsupported,
      verifiedPercentage,
      targetMet,
      unresolvedFlagged: true,
    },
  };
}
