/**
 * SSE helper — formats and writes AgentEvents to a ReadableStream controller.
 * Keeps event emission in one place so the schema stays canonical.
 */

import type { AgentEvent } from "./schemas";

export function emitEvent(
  controller: ReadableStreamDefaultController,
  event: Omit<AgentEvent, "timestamp"> & { timestamp?: string }
): void {
  const payload: AgentEvent = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  } as AgentEvent;

  const line = `data: ${JSON.stringify(payload)}\n\n`;
  controller.enqueue(new TextEncoder().encode(line));
}

export function emitDone(controller: ReadableStreamDefaultController): void {
  controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
}

export type Emitter = (
  event: Omit<AgentEvent, "timestamp"> & { timestamp?: string }
) => void;

/** Creates a bound emitter for a given stream controller. */
export function makeEmitter(
  controller: ReadableStreamDefaultController
): Emitter {
  return (event) => emitEvent(controller, event);
}
