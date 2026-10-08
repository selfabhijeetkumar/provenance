/**
 * Orchestrator Agent
 * Input: research topic string
 * Output: { subQuestions: [3], plan: string } — Zod validated
 * Retries once on malformed LLM JSON.
 */

import { chatWithRetry, parseLlmJson } from "../gemini";
import { geminiSemaphore } from "../semaphore";
import { OrchestratorOutputSchema, type OrchestratorOutput } from "../schemas";
import type { Emitter } from "../sse";

export async function runOrchestrator(
  topic: string,
  emit: Emitter
): Promise<OrchestratorOutput> {
  emit({ agent: "orchestrator", status: "started", input_summary: topic });

  const prompt = `You are a research orchestrator. Given a research topic, decompose it into exactly 3 focused sub-questions that together cover the topic comprehensively.

Return ONLY valid JSON in this exact shape:
{
  "subQuestions": ["question 1", "question 2", "question 3"],
  "plan": "one paragraph describing how these sub-questions together answer the main topic"
}

Topic: ${topic}`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      emit({
        agent: "orchestrator",
        status: "tool_call",
        tool_call: "llm_plan",
        input_summary: `Attempt ${attempt}: decompose "${topic}"`,
      });

      const raw = await geminiSemaphore.run(() =>
        chatWithRetry(
          [{ role: "user", content: prompt }],
          { jsonMode: true, temperature: 0.2 }
        )
      );

      const parsed = parseLlmJson(raw);
      const result = OrchestratorOutputSchema.parse(parsed);

      emit({
        agent: "orchestrator",
        status: "done",
        result_summary: `${result.subQuestions.length} sub-questions generated`,
        subQuestions: result.subQuestions,
      });

      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        emit({
          agent: "orchestrator",
          status: "error",
          result_summary: `Attempt ${attempt} failed, retrying: ${String(err)}`,
        });
      }
    }
  }

  throw new Error(`Orchestrator failed after 2 attempts: ${String(lastErr)}`);
}
