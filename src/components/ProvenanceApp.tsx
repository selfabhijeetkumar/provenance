"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { useEvidenceStore } from "@/lib/store";
import { AgentHud } from "./ui/AgentHud";
import { EventDrawer } from "./ui/EventDrawer";
import { SourceInspectorModal } from "./ui/SourceInspectorModal";
import { EditorialPaperPanel } from "./ui/EditorialPaperPanel";

// Dynamic import with ssr: false for Three.js Canvas
const EvidenceGraphCanvas = dynamic(
  () => import("./canvas/EvidenceGraphCanvas"),
  { ssr: false }
);

interface RunMeta {
  runId: string;
  topic: string;
  timestamp: string;
  hasReplay: boolean;
  verificationSummary?: { supported: number; weak: number; unsupported: number };
}

export function ProvenanceApp() {
  const stage = useEvidenceStore((s) => s.stage);
  const topic = useEvidenceStore((s) => s.topic);
  const setTopic = useEvidenceStore((s) => s.setTopic);
  const reset = useEvidenceStore((s) => s.reset);
  const processEvent = useEvidenceStore((s) => s.processEvent);
  const setResult = useEvidenceStore((s) => s.setResult);
  const setError = useEvidenceStore((s) => s.setError);
  const error = useEvidenceStore((s) => s.error);
  const lowComplexity = useEvidenceStore((s) => s.lowComplexity);
  const toggleLowComplexity = useEvidenceStore((s) => s.toggleLowComplexity);

  const [inputTopic, setInputTopic] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [showReplayPicker, setShowReplayPicker] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Load available runs on mount for replay picker
  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((data: RunMeta[]) => setRuns(data.filter((r) => r.hasReplay)))
      .catch(() => {});
  }, [stage]); // reload after a run completes

  async function consumeStream(res: Response, replayMode = false) {
    if (!res.body) throw new Error("No response body received from stream");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";

      for (const block of lines) {
        for (const line of block.split("\n")) {
          if (line.startsWith("data: ")) {
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") {
              // Stream finished
            } else {
              try {
                const parsed = JSON.parse(raw);
                if (parsed.type === "run_complete" || parsed.type === "replay_start") {
                  if (parsed.type === "run_complete") {
                    setResult({ ...parsed.payload, isReplay: replayMode });
                  }
                  // replay_start: topic already set
                } else {
                  processEvent(parsed);
                }
              } catch {
                // Ignore JSON parse errors on partial chunks
              }
            }
          }
        }
      }
    }
  }

  async function handleStartResearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const query = (inputTopic || topic).trim();
    if (!query || isSubmitting) return;

    setIsSubmitting(true);
    setIsReplaying(false);
    setTopic(query);
    reset();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: query }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          (errBody as { error?: string }).error ??
          `Research request failed: HTTP ${res.status}`
        );
      }

      await consumeStream(res, false);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(String(err.message));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReplay(runId: string, replayTopic: string) {
    if (isSubmitting) return;
    setShowReplayPicker(false);
    setIsSubmitting(true);
    setIsReplaying(true);
    setTopic(replayTopic);
    reset();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/replay?runId=${encodeURIComponent(runId)}`, {
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          (errBody as { error?: string }).error ??
          `Replay failed: HTTP ${res.status}`
        );
      }

      await consumeStream(res, true);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(String(err.message));
      }
    } finally {
      setIsSubmitting(false);
      setIsReplaying(false);
    }
  }

  return (
    <main className={`provenance-viewport stage-${stage}`}>
      {/* 3D Evidence Graph Canvas */}
      <EvidenceGraphCanvas />

      {/* REPLAY BANNER — shown during replay to clearly distinguish from live */}
      {isReplaying && (
        <div className="replay-banner" role="status" aria-live="polite">
          <span className="replay-icon" aria-hidden="true">&#x25B6;</span>
          REPLAY OF A REAL RUN — not live research
        </div>
      )}

      {/* Minimal Top Nav */}
      <nav className="minimal-nav" aria-label="Primary Navigation">
        <div className="nav-brand">
          <span className="brand-wordmark">PROVENANCE</span>
          <span className="brand-dot" aria-hidden="true" />
        </div>

        <div className="nav-controls">
          {runs.length > 0 && stage === "idle" && (
            <button
              type="button"
              className="control-pill pill-replay"
              onClick={() => setShowReplayPicker((v) => !v)}
              title="Replay a previous run"
              aria-expanded={showReplayPicker}
            >
              REPLAY LAST RUN
            </button>
          )}
          <button
            type="button"
            className={`control-pill ${lowComplexity ? "pill-active" : ""}`}
            onClick={toggleLowComplexity}
            title="Toggle Low Complexity / High Performance Mode"
            aria-pressed={lowComplexity}
          >
            {lowComplexity ? "ECO 3D" : "CINEMATIC 3D"}
          </button>
        </div>
      </nav>

      {/* Replay Picker Dropdown */}
      {showReplayPicker && runs.length > 0 && (
        <div className="replay-picker" role="dialog" aria-label="Replay a previous run">
          <div className="replay-picker-header">
            <span>SELECT A RUN TO REPLAY</span>
            <button
              type="button"
              className="replay-close"
              onClick={() => setShowReplayPicker(false)}
              aria-label="Close replay picker"
            >
              ✕
            </button>
          </div>
          <div className="replay-picker-note">
            Replays stream real recorded events — not live AI inference
          </div>
          <ul className="replay-run-list">
            {runs.map((run) => (
              <li key={run.runId}>
                <button
                  type="button"
                  className="replay-run-item"
                  onClick={() => handleReplay(run.runId, run.topic)}
                >
                  <span className="replay-run-topic">{run.topic}</span>
                  <span className="replay-run-meta">
                    {new Date(run.timestamp).toLocaleDateString()} ·{" "}
                    {run.verificationSummary?.supported ?? 0} verified
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Agent HUD (running & done states) */}
      <AgentHud />

      {/* IDLE STATE HERO */}
      {stage === "idle" && (
        <section className="hero-idle-container" aria-label="Research Topic Input">
          <div className="hero-content">
            <h1 className="hero-headline">
              Research you can click and <em>trust</em>.
            </h1>
            <p className="hero-subtext">
              Autonomous multi-agent research with empirical citation verification.
            </p>

            <form className="hero-input-form" onSubmit={handleStartResearch}>
              <div className="glass-input-wrapper">
                <input
                  type="text"
                  className="glass-topic-input"
                  placeholder="Enter a research topic (e.g. Direct Preference Optimization in LLMs)..."
                  value={inputTopic}
                  onChange={(e) => setInputTopic(e.target.value)}
                  disabled={isSubmitting}
                  aria-label="Research topic"
                  autoFocus
                />
                <button
                  type="submit"
                  className="glass-start-btn"
                  disabled={!inputTopic.trim() || isSubmitting}
                >
                  {isSubmitting ? "INITIATING..." : "INITIATE RESEARCH →"}
                </button>
              </div>

              {/* Sample topics for fast demo / testing */}
              <div className="topic-suggestions">
                <span className="suggestions-label">SUGGESTED DOSSIERS:</span>
                {[
                  "Direct Preference Optimization in Language Models",
                  "CRISPR-Cas9 Off-Target Effects in Human Therapeutics",
                  "Perovskite Tandem Solar Cell Durability",
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="suggestion-tag"
                    onClick={() => {
                      setInputTopic(s);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </form>
          </div>
        </section>
      )}

      {/* Error Banner */}
      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon">✕</span>
          <span className="error-text">{error}</span>
          <button
            type="button"
            className="error-dismiss"
            onClick={() => setError(null)}
          >
            DISMISS
          </button>
        </div>
      )}

      {/* DONE STATE: Editorial Paper Slide-in */}
      <EditorialPaperPanel />

      {/* Source Inspector Modal */}
      <SourceInspectorModal />

      {/* Accessible Event Log Drawer */}
      <EventDrawer />
    </main>
  );
}

export default ProvenanceApp;
