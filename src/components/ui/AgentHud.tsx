"use client";

import { useEvidenceStore, type AgentStatus } from "@/lib/store";

interface AgentItem {
  id: keyof ReturnType<typeof useEvidenceStore.getState>["agents"];
  label: string;
}

const AGENT_LIST: AgentItem[] = [
  { id: "orchestrator", label: "Orchestrator" },
  { id: "explorer-1", label: "Explorer I" },
  { id: "explorer-2", label: "Explorer II" },
  { id: "explorer-3", label: "Explorer III" },
  { id: "gatherer", label: "Gatherer" },
  { id: "writer", label: "Writer" },
  { id: "verifier", label: "Verifier" },
  { id: "publisher", label: "Publisher" },
];

export function AgentHud() {
  const agents = useEvidenceStore((s) => s.agents);
  const stage = useEvidenceStore((s) => s.stage);

  if (stage === "idle") return null;

  return (
    <header className="agent-hud-container" aria-label="Autonomous Agent Pipeline Status">
      <div className="agent-hud-pills">
        {AGENT_LIST.map(({ id, label }) => {
          const status: AgentStatus = agents[id] ?? "idle";
          return (
            <div
              key={id}
              className={`agent-hud-item status-${status}`}
              title={`${label}: ${status.toUpperCase()}`}
            >
              <span className={`status-dot dot-${status}`} aria-hidden="true" />
              <span className="agent-name">{label}</span>
              <span className="sr-only">status is {status}</span>
            </div>
          );
        })}
      </div>
    </header>
  );
}
