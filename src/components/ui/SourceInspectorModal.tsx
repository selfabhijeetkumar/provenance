"use client";

import { useEvidenceStore } from "@/lib/store";

export function SourceInspectorModal() {
  const selectedNode = useEvidenceStore((s) => s.selectedNode);
  const selectNode = useEvidenceStore((s) => s.selectNode);

  if (!selectedNode) return null;

  const isVerified = selectedNode.status === "verified";
  const isWeak = selectedNode.status === "weak";
  const isUnsupported = selectedNode.status === "unsupported";

  const verdictLabel = isVerified
    ? "VERIFIED SOURCE"
    : isWeak
    ? "WEAK SUPPORT"
    : isUnsupported
    ? "UNVERIFIED / CONTRADICTED"
    : "DISCOVERED CANDIDATE";

  return (
    <div
      className="inspector-backdrop"
      onClick={() => selectNode(null)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="inspector-title"
    >
      <div
        className={`inspector-card card-${selectedNode.status}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="inspector-header">
          <div className="inspector-badge-row">
            <span className={`badge badge-${selectedNode.status}`}>
              {verdictLabel}
            </span>
            <span className="inspector-id">[{selectedNode.id}]</span>
          </div>
          <button
            type="button"
            className="inspector-close-btn"
            onClick={() => selectNode(null)}
            aria-label="Close Inspector"
          >
            ✕
          </button>
        </div>

        <h3 id="inspector-title" className="inspector-title">
          {selectedNode.title}
        </h3>

        <div className="inspector-meta">
          <span className="inspector-authors">
            {selectedNode.authors.slice(0, 5).join(", ")}
            {selectedNode.authors.length > 5 ? " et al." : ""}
          </span>
          {selectedNode.year && (
            <span className="inspector-year"> ({selectedNode.year})</span>
          )}
        </div>

        {selectedNode.verdictReason && (
          <div className="inspector-reason-box">
            <span className="reason-label">VERIFIER ASSESSMENT:</span>
            <p className="reason-text">{selectedNode.verdictReason}</p>
          </div>
        )}

        <div className="inspector-footer">
          {selectedNode.doi && (
            <a
              href={`https://doi.org/${selectedNode.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inspector-doi-link"
            >
              Resolve DOI ↗
            </a>
          )}
          {selectedNode.url && !selectedNode.doi && (
            <a
              href={selectedNode.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inspector-doi-link"
            >
              External Source URL ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
