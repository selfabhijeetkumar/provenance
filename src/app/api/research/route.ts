/**
 * POST /api/research
 * Body: { topic: string }
 *
 * Returns an SSE stream of AgentEvents followed by the final RunResult
 * as a special "run_complete" event.
 *
 * Pipeline:
 *  Orchestrator → Explorer×3 (parallel) → Gatherer (ranked) → Writer → Verifier
 *  → Writer (if needed, max 2 rounds) → Publisher
 */

import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { makeEmitter, emitDone, emitEvent } from "@/lib/sse";
import { runOrchestrator } from "@/lib/agents/orchestrator";
import { runExplorer } from "@/lib/agents/explorer";
import { runGatherer } from "@/lib/agents/gatherer";
import { runWriter } from "@/lib/agents/writer";
import { runVerifier } from "@/lib/agents/verifier";
import { runPublisher } from "@/lib/agents/publisher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";

  if (!topic) {
    return new Response(JSON.stringify({ error: "topic is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fail fast if gateway is not configured
  if (!process.env.GEMINI_BASE_URL) {
    return new Response(
      JSON.stringify({ error: "GEMINI_BASE_URL is not configured. Set it in .env.local" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const runId = randomUUID();

  const stream = new ReadableStream({
    async start(controller) {
      const collectedEvents: string[] = []; // for replay persistence

      const rawEmit = makeEmitter(controller);
      // Wrap emitter to also collect events for replay
      const emit: typeof rawEmit = (event) => {
        rawEmit(event);
        collectedEvents.push(JSON.stringify(event));
      };

      try {
        // ── Step 1: Orchestrator ─────────────────────────────────────────────
        const orchestratorOutput = await runOrchestrator(topic, emit);
        const { subQuestions } = orchestratorOutput;

        // ── Step 2: Explorers (parallel) ─────────────────────────────────────
        const [papers1, papers2, papers3] = await Promise.all([
          runExplorer(subQuestions[0], 1, emit),
          runExplorer(subQuestions[1], 2, emit),
          runExplorer(subQuestions[2], 3, emit),
        ]);
        const allPapers = [...papers1, ...papers2, ...papers3];

        // ── Step 3: Gatherer (topic-aware relevance ranking) ──────────────────
        const evidenceTable = await runGatherer(allPapers, emit, topic);

        if (evidenceTable.claims.length === 0) {
          emitEvent(controller, {
            agent: "gatherer",
            status: "error",
            result_summary: "No claims extracted — cannot proceed to writing",
          });
          emitDone(controller);
          controller.close();
          return;
        }

        // ── Step 4+5: Writer → Verifier loop (max 2 iterations) ──────────────
        let draft = await runWriter(topic, evidenceTable, undefined, 1, emit);
        let verifierOutput = await runVerifier(draft, evidenceTable, 1, emit);

        if (verifierOutput.feedbackForWriter !== null) {
          // One correction round
          draft = await runWriter(
            topic,
            evidenceTable,
            verifierOutput.feedbackForWriter,
            2,
            emit
          );
          verifierOutput = await runVerifier(draft, evidenceTable, 2, emit);
        }

        const finalDraft = verifierOutput.draftWithFlags;

        // ── Step 6: Publisher (receives collected events for replay) ──────────
        const publishResult = await runPublisher(
          runId,
          topic,
          finalDraft,
          evidenceTable,
          verifierOutput.results,
          emit,
          collectedEvents
        );

        // Emit the full run result so the client can render the paper
        const runResult = {
          runId,
          topic,
          draft: finalDraft,
          evidenceTable,
          verificationResults: verifierOutput.results,
          publishResult,
        };

        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ type: "run_complete", payload: runResult })}\n\n`
          )
        );
      } catch (err) {
        emitEvent(controller, {
          agent: "orchestrator",
          status: "error",
          result_summary: `Pipeline failed: ${String(err)}`,
        });
      } finally {
        emitDone(controller);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
