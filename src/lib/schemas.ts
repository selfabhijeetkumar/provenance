import { z } from "zod";

// ── Orchestrator ──────────────────────────────────────────────────────────────

export const OrchestratorOutputSchema = z.object({
  subQuestions: z.array(z.string().min(1)).length(3),
  plan: z.string().min(1),
});
export type OrchestratorOutput = z.infer<typeof OrchestratorOutputSchema>;

// ── Explorer ──────────────────────────────────────────────────────────────────

export const PaperSchema = z.object({
  id: z.string(),          // DOI or openalex id or arxiv id
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().optional(),
  abstract: z.string().optional(),
  doi: z.string().optional(),
  url: z.string().optional(),
  source: z.enum(["arxiv", "openalex"]),
});
export type Paper = z.infer<typeof PaperSchema>;

// ── Gatherer ──────────────────────────────────────────────────────────────────

export const ClaimSchema = z.object({
  claimId: z.string(),
  claim: z.string(),
  sourceId: z.string(),   // maps to Paper.id
  paperId: z.string(),
  abstract: z.string(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const EvidenceTableSchema = z.object({
  claims: z.array(ClaimSchema),
  papers: z.array(PaperSchema),
});
export type EvidenceTable = z.infer<typeof EvidenceTableSchema>;

export const ClaimsExtractionSchema = z.object({
  claims: z.array(
    z.object({
      claimId: z.string(),
      claim: z.string(),
    })
  ),
});

// ── Writer ────────────────────────────────────────────────────────────────────

export const DraftSchema = z.object({
  abstract: z.string().min(1),
  findings: z.string().min(1),
  limitations: z.string().min(1),
  references: z.string().min(1),
});
export type Draft = z.infer<typeof DraftSchema>;

// ── Verifier ──────────────────────────────────────────────────────────────────

export const Verdict = z.enum(["supported", "weak", "unsupported"]);
export type Verdict = z.infer<typeof Verdict>;

export const VerificationResultSchema = z.object({
  claimId: z.string(),
  verdict: Verdict,
  reason: z.string(),
  deterministicPass: z.boolean(),
  urlResolved: z.boolean().optional(),
  metadataMatch: z.boolean().optional(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const LLMVerdictSchema = z.object({
  claimId: z.string(),
  verdict: Verdict,
  reason: z.string(),
});
export const LLMVerdictsSchema = z.object({
  verdicts: z.array(LLMVerdictSchema),
});

// ── SSE Events ────────────────────────────────────────────────────────────────

export const AgentEventSchema = z.object({
  agent: z.enum([
    "orchestrator",
    "explorer-1",
    "explorer-2",
    "explorer-3",
    "gatherer",
    "writer",
    "verifier",
    "publisher",
  ]),
  status: z.enum([
    "started",
    "tool_call",
    "result",
    "degraded",
    "error",
    "done",
  ]),
  tool_call: z.string().optional(),
  input_summary: z.string().optional(),
  result_summary: z.string().optional(),
  timestamp: z.string(),
  iteration: z.number().optional(),

  // Additive fields for 3D Evidence Graph
  subQuestions: z.array(z.string()).optional(),
  subQuestionIndex: z.number().optional(),
  sourceId: z.string().optional(),
  claimId: z.string().optional(),
  title: z.string().optional(),
  authors: z.array(z.string()).optional(),
  year: z.number().optional(),
  doi: z.string().optional(),
  url: z.string().optional(),
  verdict: z.enum(["verified", "supported", "weak", "unsupported"]).optional(),
  reason: z.string().optional(),
  citedClaimIds: z.array(z.string()).optional(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ── Publisher ─────────────────────────────────────────────────────────────────

export const PublishResultSchema = z.object({
  runId: z.string(),
  markdownPath: z.string(),
  webhookFired: z.boolean(),
  webhookStatus: z.number().optional(),
});
export type PublishResult = z.infer<typeof PublishResultSchema>;

// ── Run Result ────────────────────────────────────────────────────────────────

export const RunResultSchema = z.object({
  runId: z.string(),
  topic: z.string(),
  draft: DraftSchema,
  evidenceTable: EvidenceTableSchema,
  verificationResults: z.array(VerificationResultSchema),
  publishResult: PublishResultSchema,
});
export type RunResult = z.infer<typeof RunResultSchema>;
