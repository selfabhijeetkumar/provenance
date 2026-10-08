/**
 * GET /api/replay?runId=<uuid>
 *
 * Re-streams the recorded SSE event log from a completed run.
 * Each event is streamed at its original inter-event pacing (capped at 200ms delay).
 * Prepends a "replay_start" control event so the UI can show the REPLAY banner.
 * Appends the run_complete payload from meta.json so the paper panel appears.
 *
 * REPLAY is clearly distinguishable from a live run — the UI must show
 * "REPLAY of a real run" at all times while streaming.
 */

import { NextRequest } from "next/server";
import { existsSync, readFileSync, createReadStream } from "fs";
import { join } from "path";
import { createInterface } from "readline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INTER_EVENT_DELAY_MS = 200;

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");

  if (!runId || !/^[0-9a-f-]{36}$/.test(runId)) {
    return new Response(JSON.stringify({ error: "Invalid runId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const runDir = join(process.cwd(), "runs", runId);
  const replayPath = join(runDir, "replay.jsonl");
  const metaPath = join(runDir, "meta.json");

  if (!existsSync(replayPath)) {
    return new Response(
      JSON.stringify({ error: `No replay found for run ${runId}. Complete a run first.` }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // Load meta for run_complete payload
  let metaPayload: Record<string, unknown> | null = null;
  if (existsSync(metaPath)) {
    try {
      metaPayload = JSON.parse(readFileSync(metaPath, "utf-8"));
    } catch {
      // non-fatal
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      function send(data: string) {
        controller.enqueue(enc.encode(`data: ${data}\n\n`));
      }

      // Signal that this is a replay, not a live run
      send(
        JSON.stringify({
          type: "replay_start",
          runId,
          topic: (metaPayload?.topic as string) ?? "",
          isReplay: true,
        })
      );

      // Stream recorded events line by line with pacing
      await new Promise<void>((resolve, reject) => {
        const rl = createInterface({
          input: createReadStream(replayPath, { encoding: "utf-8" }),
          crlfDelay: Infinity,
        });

        const lines: string[] = [];
        rl.on("line", (line) => {
          if (line.trim()) lines.push(line.trim());
        });

        rl.on("close", async () => {
          try {
            for (const line of lines) {
              send(line);
              // Pace replay: small fixed delay to animate the graph
              await new Promise((r) => setTimeout(r, MAX_INTER_EVENT_DELAY_MS));
            }
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        rl.on("error", reject);
      });

      // Emit run_complete if meta exists so the paper panel appears
      if (metaPayload) {
        // Build a minimal RunResult from meta
        const runComplete = {
          type: "run_complete",
          payload: {
            runId: metaPayload.runId,
            topic: metaPayload.topic,
            draft: metaPayload.draft ?? {
              abstract: "(replay — open paper.md for full text)",
              findings: "(replay)",
              limitations: "(replay)",
              references: "(replay)",
            },
            evidenceTable: { claims: [], papers: metaPayload.papers ?? [] },
            verificationResults: metaPayload.verificationResults ?? [],
            publishResult: {
              runId: metaPayload.runId as string,
              markdownPath: join(runDir, "paper.md"),
              webhookFired: false,
            },
            isReplay: true,
          },
        };
        send(JSON.stringify(runComplete));
      }

      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
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

/**
 * GET /api/replay/list — returns available runs for the replay picker
 */
export async function GET_LIST() {
  // This is handled by /api/runs/list separately
}
