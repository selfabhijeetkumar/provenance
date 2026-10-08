"use client";

import { useState, useRef } from "react";
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
  const abortRef = useRef<AbortController | null>(null);

  async function handleStartResearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const query = (inputTopic || topic).trim();
    if (!query || isSubmitting) return;

    setIsSubmitting(true);
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
        throw new Error(`Research request failed: HTTP ${res.status}`);
      }

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
                  if (parsed.type === "run_complete") {
                    setResult(parsed.payload);
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
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(String(err.message));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={`provenance-viewport stage-${stage}`}>
      {/* 3D Evidence Graph Canvas */}
      <EvidenceGraphCanvas />

      {/* Minimal Top Nav */}
      <nav className="minimal-nav" aria-label="Primary Navigation">
        <div className="nav-brand">
          <span className="brand-wordmark">PROVENANCE</span>
          <span className="brand-dot" aria-hidden="true" />
        </div>

        <div className="nav-controls">
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
