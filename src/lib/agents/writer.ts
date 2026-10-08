/**
 * Writer Agent
 * Drafts 4 sections: Abstract, Findings, Limitations, References.
 * Every factual claim must carry [claimId] from the evidence table.
 * Writer cannot cite anything outside the evidence table.
 *
 * CITATION DENSITY REQUIREMENT: must cite at least 8 distinct claims,
 * spread across as many papers as possible.
 */

import { chatWithRetry, parseLlmJson } from "../gemini";
import { geminiSemaphore } from "../semaphore";
import { DraftSchema, type Draft, type EvidenceTable } from "../schemas";
import type { Emitter } from "../sse";

function buildEvidenceSummary(table: EvidenceTable): string {
  // Include ALL claims (not just 30) for maximum citation density
  return table.claims
    .map((c) => `[${c.claimId}] (paper: ${c.paperId}): ${c.claim}`)
    .join("\n");
}

function buildReferenceList(table: EvidenceTable): string {
  return table.papers
    .slice(0, 40)
    .map((p) => {
      const authors = p.authors.slice(0, 3).join(", ");
      const more = p.authors.length > 3 ? " et al." : "";
      const doi = p.doi ? ` DOI: ${p.doi}` : "";
      return `[${p.id}] ${authors}${more} (${p.year ?? "n.d."}). ${p.title}.${doi}`;
    })
    .join("\n");
}

export async function runWriter(
  topic: string,
  table: EvidenceTable,
  feedbackFromVerifier?: string,
  iteration = 1,
  emit?: Emitter
): Promise<Draft> {
  emit?.({
    agent: "writer",
    status: "started",
    input_summary: `Drafting paper on "${topic}" (iteration ${iteration})`,
    iteration,
  });

  const evidenceSummary = buildEvidenceSummary(table);
  const referenceList = buildReferenceList(table);
  const claimCount = table.claims.length;

  const feedbackSection = feedbackFromVerifier
    ? `\n\nVERIFIER FEEDBACK (you MUST fix these issues in this revision):\n${feedbackFromVerifier}`
    : "";

  const prompt = `You are a research writer. Write a structured research paper on the given topic using ONLY the evidence provided.

RULES:
1. Every factual claim MUST end with [claimId] citing a claim from the evidence list below.
2. You MUST NOT cite any source not in the evidence list.
3. You MUST cite at least ${Math.min(claimCount, 8)} distinct claims spread across as many papers as possible.
4. Write in formal academic English.
5. Findings section: 3-5 paragraphs, each paragraph making at least 2 cited claims.
6. Limitations section must acknowledge gaps in the evidence.
7. References section must list ONLY papers actually cited in the text.
8. Do not pad with uncited sentences — if you cannot support a sentence with a citation from the list, omit it.
${feedbackSection}

TOPIC: ${topic}

AVAILABLE EVIDENCE (${claimCount} claims — cite as many as relevant):
${evidenceSummary}

AVAILABLE REFERENCES:
${referenceList}

Return ONLY valid JSON:
{
  "abstract": "One paragraph summary citing 2-3 key claims [claimId]...",
  "findings": "3-5 paragraphs of main findings, EVERY factual sentence followed by [claimId]...",
  "limitations": "1-2 paragraphs on limitations of the evidence base...",
  "references": "Formatted reference list of ONLY cited sources..."
}`;

  emit?.({
    agent: "writer",
    status: "tool_call",
    tool_call: "llm_draft",
    input_summary: `Iteration ${iteration} with ${claimCount} claims available`,
    iteration,
  });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await geminiSemaphore.run(() =>
        chatWithRetry(
          [{ role: "user", content: prompt }],
          { jsonMode: true, temperature: 0.3, maxTokens: 8000 }
        )
      );

      const parsed = parseLlmJson(raw);
      const draft = DraftSchema.parse(parsed);

      const citedClaimIds = Array.from(
        new Set(
          (`${draft.abstract} ${draft.findings} ${draft.limitations}`)
            .match(/\[([^\]]+)\]/g)
            ?.map((m) => m.slice(1, -1))
            ?.filter((id) => !id.startsWith("UNVERIFIED")) ?? []
        )
      );

      emit?.({
        agent: "writer",
        status: "done",
        result_summary: `Draft complete (iteration ${iteration}) with ${citedClaimIds.length} citations`,
        iteration,
        citedClaimIds,
      });

      return draft;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        emit?.({
          agent: "writer",
          status: "error",
          result_summary: `Attempt ${attempt} failed: ${String(err)}`,
          iteration,
        });
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  }

  throw new Error(`Writer failed after 2 attempts (iteration ${iteration}): ${String(lastErr)}`);
}
