"use client";

import { useEvidenceStore } from "@/lib/store";
import type { VerificationResult, EvidenceTable } from "@/lib/schemas";

export function EditorialPaperPanel() {
  const result = useEvidenceStore((s) => s.result);
  const stage = useEvidenceStore((s) => s.stage);
  const flyToSource = useEvidenceStore((s) => s.flyToSource);

  if (stage !== "done" || !result) return null;

  return (
    <article className="editorial-paper-panel" aria-label="Generated Research Paper">
      <div className="editorial-paper-scroll">
        <header className="paper-masthead">
          <div className="paper-edition-label">AUTONOMOUS RESEARCH DOSSIER · TRACK II</div>
          <h1 className="paper-headline">{result.topic}</h1>
          <div className="paper-byline">
            <span>RUN <code>{result.runId.slice(0, 8)}</code></span>
            <span>·</span>
            <span>{result.evidenceTable.papers.length} SOURCES HARVESTED</span>
            <span>·</span>
            <span>{result.evidenceTable.claims.length} VERIFIED CLAIMS</span>
          </div>

          <div className="paper-verdict-summary">
            <span className="summary-pill pill-verified">
              {result.verificationResults.filter((r) => r.verdict === "supported").length} VERIFIED
            </span>
            <span className="summary-pill pill-weak">
              {result.verificationResults.filter((r) => r.verdict === "weak").length} WEAK
            </span>
            <span className="summary-pill pill-unverified">
              {result.verificationResults.filter((r) => r.verdict === "unsupported").length} UNVERIFIED
            </span>
          </div>
        </header>

        <section className="editorial-section">
          <h2 className="section-eyebrow">ABSTRACT</h2>
          <div className="section-body serif-text">
            <AnnotatedEditorialText
              text={result.draft.abstract}
              results={result.verificationResults}
              table={result.evidenceTable}
              onFly={flyToSource}
            />
          </div>
        </section>

        <section className="editorial-section">
          <h2 className="section-eyebrow">FINDINGS & EMPIRICAL EVIDENCE</h2>
          <div className="section-body serif-text">
            <AnnotatedEditorialText
              text={result.draft.findings}
              results={result.verificationResults}
              table={result.evidenceTable}
              onFly={flyToSource}
            />
          </div>
        </section>

        <section className="editorial-section">
          <h2 className="section-eyebrow">LIMITATIONS & EVIDENCE GAPS</h2>
          <div className="section-body serif-text">
            <AnnotatedEditorialText
              text={result.draft.limitations}
              results={result.verificationResults}
              table={result.evidenceTable}
              onFly={flyToSource}
            />
          </div>
        </section>

        <section className="editorial-section references-block">
          <h2 className="section-eyebrow">HARVESTED CITATION REGISTRY</h2>
          <div className="editorial-references-list">
            {result.evidenceTable.papers.slice(0, 30).map((paper) => {
              const check = result.verificationResults.find(
                (r) => r.claimId.startsWith(paper.id) || paper.id.startsWith(r.claimId)
              );
              return (
                <div
                  key={paper.id}
                  className="editorial-reference-row"
                  onClick={() => flyToSource(paper.id)}
                >
                  <div className="ref-source-id">[{paper.id}]</div>
                  <div className="ref-details">
                    <div className="ref-title">{paper.title}</div>
                    <div className="ref-authors">
                      {paper.authors.slice(0, 4).join(", ")}
                      {paper.authors.length > 4 ? " et al." : ""}{" "}
                      ({paper.year ?? "n.d."})
                    </div>
                    {paper.doi && (
                      <a
                        href={`https://doi.org/${paper.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ref-doi-link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        DOI: {paper.doi} ↗
                      </a>
                    )}
                  </div>
                  {check && (
                    <span className={`badge badge-${check.verdict}`}>
                      {check.verdict.toUpperCase()}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <footer className="editorial-actions-bar">
          <button
            type="button"
            className="action-btn btn-print"
            onClick={() => window.print()}
          >
            PRINT / SAVE AS PDF
          </button>
          <a
            href={`/api/download?runId=${result.runId}`}
            className="action-btn btn-download"
            download
          >
            DOWNLOAD MARKDOWN
          </a>
        </footer>
      </div>
    </article>
  );
}

function AnnotatedEditorialText({
  text,
  results,
  table,
  onFly,
}: {
  text: string;
  results: VerificationResult[];
  table: EvidenceTable;
  onFly: (id: string) => void;
}) {
  const parts = text.split(/(\[[^\]]+\])/g);

  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("[") && part.endsWith("]")) {
          const id = part.slice(1, -1);
          const v = results.find(
            (r) =>
              r.claimId === id ||
              r.claimId.startsWith(id) ||
              id.startsWith(r.claimId)
          );
          const paper = table.papers.find((p) => p.id === id || id.startsWith(p.id));
          const verdict = v?.verdict;
          const statusClass =
            verdict === "supported"
              ? "cite-verified"
              : verdict === "weak"
              ? "cite-weak"
              : verdict === "unsupported"
              ? "cite-unverified"
              : "cite-discovered";

          return (
            <button
              key={i}
              type="button"
              className={`editorial-citation ${statusClass}`}
              onClick={() => onFly(id)}
              title={
                v
                  ? `[${verdict?.toUpperCase()}]: ${v.reason}`
                  : paper
                  ? `${paper.title} (${paper.year ?? ""})`
                  : id
              }
              aria-label={`Citation ${id}, status: ${verdict ?? "discovered"}`}
            >
              <span>{part}</span>
              {verdict && (
                <span className="cite-pip" aria-hidden="true">
                  {verdict === "supported" ? "✓" : verdict === "weak" ? "!" : "×"}
                </span>
              )}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
