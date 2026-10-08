/**
 * Writer Agent
 * Drafts 4 sections: Abstract, Findings, Limitations, References.
 * Every factual claim must carry [sourceId] from the evidence table.
 * Writer cannot cite anything outside the evidence table.
 */

import { chatWithRetry } from "../gemini";
import { geminiSemaphore } from "../semaphore";
import { DraftSchema, type Draft, type EvidenceTable } from "../schemas";
import type { Emitter } from "../sse";

function buildEvidenceSummary(table: EvidenceTable): string {
  return table.claims
    .slice(0, 30) // cap to keep prompt size reasonable
    .map((c) => `[${c.claimId}] (source: ${c.sourceId}): ${c.claim}`)
    .join("\n");
}

function buildReferenceList(table: EvidenceTable): string {
  return table.papers
    .slice(0, 20)
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

  const feedbackSection = feedbackFromVerifier
    ? `\n\nVERIFIER FEEDBACK (fix these issues in this revision):\n${feedbackFromVerifier}`
    : "";

  const prompt = `You are a research writer. Write a structured research paper on the given topic using ONLY the evidence provided.

RULES:
1. Every factual claim MUST end with [claimId] citing a claim from the evidence list.
2. You MUST NOT cite any source not in the evidence list.
3. Write in formal academic English.
4. Keep Findings section focused and specific.
5. Limitations section must acknowledge gaps in the evidence.
6. References section must list only papers actually cited.

TOPIC: ${topic}

AVAILABLE EVIDENCE (claim -> source):
${evidenceSummary}

AVAILABLE REFERENCES:
${referenceList}
${feedbackSection}

Return ONLY valid JSON:
{
  "abstract": "One paragraph summary of the paper...",
  "findings": "2-4 paragraphs of main findings, each claim followed by [claimId]...",
  "limitations": "1-2 paragraphs on limitations of evidence...",
  "references": "Formatted reference list of cited sources..."
}`;

  emit?.({
    agent: "writer",
    status: "tool_call",
    tool_call: "llm_draft",
    input_summary: `Iteration ${iteration}`,
    iteration,
  });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await geminiSemaphore.run(() =>
        chatWithRetry(
          [{ role: "user", content: prompt }],
          { jsonMode: true, temperature: 0.4, maxTokens: 6000 }
        )
      );

      const parsed = JSON.parse(raw);
      const draft = DraftSchema.parse(parsed);

      emit?.({
        agent: "writer",
        status: "done",
        result_summary: `Draft complete (iteration ${iteration})`,
        iteration,
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
