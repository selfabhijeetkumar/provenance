import { create } from "zustand";
import type { AgentEvent, RunResult } from "./schemas";

export type PipelineStage = "idle" | "running" | "done";

export type NodeStatus = "discovered" | "verified" | "weak" | "unsupported";

export interface SourceNode {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  url?: string;
  subQuestionIndex: number;
  position: [number, number, number];
  status: NodeStatus;
  verdictReason?: string;
  claimId?: string;
}

export interface HubNode {
  index: number;
  title: string;
  position: [number, number, number];
  status: "idle" | "active" | "degraded" | "done";
}

export interface ConnectionBeam {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  type: "hub" | "claim" | "link";
}

export type AgentStatus = "idle" | "running" | "degraded" | "error" | "done";

export interface EvidenceState {
  stage: PipelineStage;
  topic: string;
  subQuestions: string[];
  hubs: HubNode[];
  nodes: SourceNode[];
  beams: ConnectionBeam[];
  claimCount: number;
  agents: {
    orchestrator: AgentStatus;
    "explorer-1": AgentStatus;
    "explorer-2": AgentStatus;
    "explorer-3": AgentStatus;
    gatherer: AgentStatus;
    writer: AgentStatus;
    verifier: AgentStatus;
    publisher: AgentStatus;
  };
  events: AgentEvent[];
  result: RunResult | null;
  selectedNode: SourceNode | null;
  targetCamera: [number, number, number] | null;
  scanSweep: boolean;
  lowComplexity: boolean;
  webGlSupported: boolean;
  error: string | null;

  // Actions
  setTopic: (t: string) => void;
  setStage: (s: PipelineStage) => void;
  reset: () => void;
  processEvent: (event: AgentEvent) => void;
  setResult: (res: RunResult) => void;
  setError: (err: string | null) => void;
  selectNode: (node: SourceNode | null) => void;
  flyToSource: (sourceId: string) => void;
  toggleLowComplexity: () => void;
  setWebGlSupported: (v: boolean) => void;
}

// Hub 3D positions in a triangle around center
const HUB_POSITIONS: [number, number, number][] = [
  [-6, 3, -1],
  [6, 3, -1],
  [0, -5, -1],
];

// Seeded deterministic offset around hub
function calcNodePosition(
  hubIndex: number,
  nodeIdx: number,
  totalNodes: number
): [number, number, number] {
  const [hx, hy, hz] = HUB_POSITIONS[hubIndex - 1] ?? [0, 0, 0];
  const angle = (nodeIdx / Math.max(totalNodes, 8)) * Math.PI * 2 + (hubIndex * 1.3);
  const radius = 2.4 + (nodeIdx % 3) * 0.9;
  const zOffset = ((nodeIdx % 5) - 2) * 0.8;
  return [
    hx + Math.cos(angle) * radius,
    hy + Math.sin(angle) * radius,
    hz + zOffset,
  ];
}

const INITIAL_AGENTS = {
  orchestrator: "idle" as AgentStatus,
  "explorer-1": "idle" as AgentStatus,
  "explorer-2": "idle" as AgentStatus,
  "explorer-3": "idle" as AgentStatus,
  gatherer: "idle" as AgentStatus,
  writer: "idle" as AgentStatus,
  verifier: "idle" as AgentStatus,
  publisher: "idle" as AgentStatus,
};

export const useEvidenceStore = create<EvidenceState>((set, get) => ({
  stage: "idle",
  topic: "",
  subQuestions: [],
  hubs: [],
  nodes: [],
  beams: [],
  claimCount: 0,
  agents: { ...INITIAL_AGENTS },
  events: [],
  result: null,
  selectedNode: null,
  targetCamera: null,
  scanSweep: false,
  lowComplexity: false,
  webGlSupported: true,
  error: null,

  setTopic: (topic) => set({ topic }),
  setStage: (stage) => set({ stage }),

  reset: () =>
    set({
      stage: "running",
      subQuestions: [],
      hubs: [],
      nodes: [],
      beams: [],
      claimCount: 0,
      agents: { ...INITIAL_AGENTS },
      events: [],
      result: null,
      selectedNode: null,
      targetCamera: [0, 0, 18],
      scanSweep: false,
      error: null,
    }),

  setError: (error) => set({ error }),
  setResult: (result) => set({ result, stage: "done" }),
  selectNode: (selectedNode) => set({ selectedNode }),

  toggleLowComplexity: () =>
    set((state) => ({ lowComplexity: !state.lowComplexity })),

  setWebGlSupported: (webGlSupported) => set({ webGlSupported }),

  flyToSource: (sourceId) => {
    const { nodes } = get();
    const node = nodes.find(
      (n) => n.id === sourceId || sourceId.startsWith(n.id) || n.id.startsWith(sourceId)
    );
    if (node) {
      const [x, y, z] = node.position;
      set({
        selectedNode: node,
        targetCamera: [x, y, z + 6],
      });
    }
  },

  processEvent: (event) => {
    set((state) => {
      const newEvents = [...state.events, event];
      const agentKey = event.agent as keyof typeof state.agents;
      const updatedAgents = { ...state.agents };

      if (event.status === "started" || event.status === "tool_call") {
        updatedAgents[agentKey] = "running";
      } else if (event.status === "degraded") {
        updatedAgents[agentKey] = "degraded";
      } else if (event.status === "error") {
        updatedAgents[agentKey] = "error";
      } else if (event.status === "done") {
        updatedAgents[agentKey] = "done";
      }

      let newHubs = state.hubs;
      let newSubQuestions = state.subQuestions;
      let newNodes = state.nodes;
      let newBeams = state.beams;
      let newClaimCount = state.claimCount;
      let scanSweep = state.scanSweep;

      // ── Orchestrator Hubs ──
      if (event.agent === "orchestrator" && event.subQuestions && event.subQuestions.length > 0) {
        newSubQuestions = event.subQuestions;
        newHubs = event.subQuestions.slice(0, 3).map((title, i) => ({
          index: i + 1,
          title,
          position: HUB_POSITIONS[i] ?? [0, 0, 0],
          status: "active",
        }));
      }

      // ── Explorers: spawn source nodes ──
      if (
        (event.agent === "explorer-1" ||
          event.agent === "explorer-2" ||
          event.agent === "explorer-3") &&
        event.sourceId &&
        event.title
      ) {
        const hubIdx =
          event.subQuestionIndex ??
          (event.agent === "explorer-1" ? 1 : event.agent === "explorer-2" ? 2 : 3);

        const exists = state.nodes.some((n) => n.id === event.sourceId);
        if (!exists && state.nodes.length < 60) {
          const nodeCountForHub = state.nodes.filter((n) => n.subQuestionIndex === hubIdx).length;
          const pos = calcNodePosition(hubIdx, nodeCountForHub, 12);
          const newNode: SourceNode = {
            id: event.sourceId,
            title: event.title,
            authors: event.authors ?? [],
            year: event.year,
            doi: event.doi,
            url: event.url,
            subQuestionIndex: hubIdx,
            position: pos,
            status: "discovered",
          };
          newNodes = [...state.nodes, newNode];

          // Hub to node beam
          const hubPos = HUB_POSITIONS[hubIdx - 1] ?? [0, 0, 0];
          newBeams = [
            ...state.beams,
            {
              id: `hub-${hubIdx}-${event.sourceId}`,
              from: hubPos,
              to: pos,
              color: "#38bdf8",
              type: "hub",
            },
          ];
        }
      }

      // ── Gatherer: inter-paper links ──
      if (event.agent === "gatherer") {
        if (event.status === "tool_call" || event.status === "result") {
          // Increment claim count or draw cross-links
          if (newNodes.length >= 2 && state.beams.filter((b) => b.type === "link").length < 15) {
            const randomA = newNodes[Math.floor(Math.random() * newNodes.length)];
            const randomB = newNodes[Math.floor(Math.random() * newNodes.length)];
            if (randomA && randomB && randomA.id !== randomB.id) {
              newBeams = [
                ...newBeams,
                {
                  id: `link-${randomA.id}-${randomB.id}`,
                  from: randomA.position,
                  to: randomB.position,
                  color: "#d4af37",
                  type: "link",
                },
              ];
            }
          }
        }
        if (event.result_summary && event.result_summary.includes("claims")) {
          const match = event.result_summary.match(/(\d+)\s+claims/);
          if (match) newClaimCount = parseInt(match[1], 10);
        }
      }

      // ── Writer: claim beams from center (0,0,0) to cited nodes ──
      if (event.agent === "writer" && event.citedClaimIds && event.citedClaimIds.length > 0) {
        const cited = new Set(event.citedClaimIds);
        const centerPos: [number, number, number] = [0, 0, 0];
        const claimBeams: ConnectionBeam[] = [];

        newNodes.forEach((node) => {
          const isCited =
            cited.has(node.id) ||
            Array.from(cited).some((cid) => cid.startsWith(node.id) || node.id.startsWith(cid));
          if (isCited) {
            claimBeams.push({
              id: `claim-${node.id}`,
              from: centerPos,
              to: node.position,
              color: "#818cf8",
              type: "claim",
            });
          }
        });
        newBeams = [
          ...newBeams.filter((b) => b.type !== "claim"),
          ...claimBeams,
        ];
      }

      // ── Verifier: scan ring sweep + verdict locking ──
      if (event.agent === "verifier") {
        if (event.status === "started" || event.tool_call === "llm_support_check") {
          scanSweep = true;
        }

        if (event.sourceId && event.verdict) {
          const v = event.verdict;
          const status: NodeStatus =
            v === "verified" || v === "supported"
              ? "verified"
              : v === "weak"
              ? "weak"
              : "unsupported";

          newNodes = newNodes.map((n) => {
            if (
              n.id === event.sourceId ||
              event.sourceId?.startsWith(n.id) ||
              n.id.startsWith(event.sourceId ?? "") ||
              (event.claimId && event.claimId.startsWith(n.id))
            ) {
              return {
                ...n,
                status,
                verdictReason: event.reason,
                claimId: event.claimId,
              };
            }
            return n;
          });
        }
      }

      return {
        events: newEvents,
        agents: updatedAgents,
        hubs: newHubs,
        subQuestions: newSubQuestions,
        nodes: newNodes,
        beams: newBeams,
        claimCount: newClaimCount,
        scanSweep,
      };
    });
  },
}));
