/**
 * Unit tests for PROVENANCE Verification Engine:
 *   1. Verifier deterministic checks (extractCitations, validateMetadata, extractArxivYear, deterministicCheck)
 *   2. False pass prevention:
 *      - matching case passes
 *      - wrong year fails (e.g. arXiv 1904 preprint claimed as 2012)
 *      - wrong/empty title fails
 *      - missing authors fails
 *      - id not in evidence table fails
 *      - unresolvable DOI fails
 *   3. Deduplication (deduplicatePapers)
 *   4. Citation extraction
 *
 * Run: npm test (or: npx tsx src/lib/__tests__/verifier.test.ts)
 */

import assert from "node:assert/strict";
import { deduplicatePapers } from "../agents/gatherer";
import {
  deterministicCheck,
  extractArxivYear,
  validateMetadata,
} from "../agents/verifier";
import type { Claim, EvidenceTable, Paper } from "../schemas";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: overrides.id ?? "arxiv:test:1",
    title: overrides.title ?? "A Rigorous Examination of Surface Codes",
    authors: overrides.authors ?? ["Alice Walker", "Bob Smith"],
    year: overrides.year ?? 2024,
    abstract: overrides.abstract ?? "A comprehensive analysis of surface code quantum error correction.",
    doi: overrides.doi,
    url: overrides.url ?? "http://example.com/paper",
    source: overrides.source ?? "arxiv",
  };
}

function makeClaim(paperId: string, claimId: string, claimText: string): Claim {
  return {
    claimId,
    claim: claimText,
    sourceId: paperId,
    paperId,
    abstract: "A comprehensive analysis of surface code quantum error correction.",
  };
}

function makeTable(claims: Claim[], papers: Paper[]): EvidenceTable {
  return { claims, papers };
}

function extractCitations(text: string): string[] {
  const matches = text.match(/\[([^\]]+)\]/g) ?? [];
  const ids: string[] = [];
  for (const m of matches) {
    const inner = m.slice(1, -1);
    for (const part of inner.split(",")) {
      const trimmed = part.trim();
      if (trimmed && !trimmed.startsWith("UNVERIFIED") && !trimmed.startsWith("http")) {
        ids.push(trimmed);
      }
    }
  }
  return ids;
}

// ── Test Runner ───────────────────────────────────────────────────────────────

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

// ── Citation Extraction Tests ─────────────────────────────────────────────────

test("extractCitations: extracts simple claimId", () => {
  const ids = extractCitations("The CRISPR/Cas approach [arxiv:1904.06375v2:1] was demonstrated.");
  assert.deepEqual(ids, ["arxiv:1904.06375v2:1"]);
});

test("extractCitations: extracts multiple claimIds", () => {
  const ids = extractCitations("First [id:1] and second [id:2] claims.");
  assert.deepEqual(ids, ["id:1", "id:2"]);
});

test("extractCitations: skips UNVERIFIED tags", () => {
  const ids = extractCitations("[UNVERIFIED:id:1] This is flagged.");
  assert.deepEqual(ids, []);
});

test("extractCitations: skips http links", () => {
  const ids = extractCitations("[https://openalex.org/W123] is a link.");
  assert.deepEqual(ids, []);
});

test("extractCitations: handles comma-separated ids", () => {
  const ids = extractCitations("[id:1, id:2]");
  assert.deepEqual(ids, ["id:1", "id:2"]);
});

// ── arXiv Year Extraction Tests ───────────────────────────────────────────────

test("extractArxivYear: handles modern and legacy arXiv IDs", () => {
  assert.equal(extractArxivYear("arxiv:1904.06375v2"), 2019);
  assert.equal(extractArxivYear("arxiv:2305.11917v1"), 2023);
  assert.equal(extractArxivYear("arxiv:0801.1234v3"), 2008);
  assert.equal(extractArxivYear("arxiv:q-bio/0309011v2"), 2003);
  assert.equal(extractArxivYear("arxiv:astro-ph/0609027v1"), 2006);
  assert.equal(extractArxivYear("openalex:https://openalex.org/W123"), null);
});

// ── TASK 2 Deterministic Verifier Audits ───────────────────────────────────────

test("deterministicCheck: matching case passes", async () => {
  const paper = makePaper({ id: "arxiv:1904.06375v2", year: 2019 });
  const claim = makeClaim("arxiv:1904.06375v2", "arxiv:1904.06375v2:1", "CRISPR demonstrated in 2012");
  const table = makeTable([claim], [paper]);
  const result = await deterministicCheck(claim, table, true);
  assert.equal(result.pass, true);
  assert.equal(result.metadataMatch, true);
});

test("deterministicCheck: wrong year fails (arXiv 1904 claimed as 2012)", async () => {
  // A paper with arXiv ID 1904 is April 2019. If recorded metadata claims 2012, it must fail.
  const paper = makePaper({ id: "arxiv:1904.06375v2", year: 2012 });
  const claim = makeClaim("arxiv:1904.06375v2", "arxiv:1904.06375v2:1", "CRISPR demonstrated in 2012");
  const table = makeTable([claim], [paper]);
  const result = await deterministicCheck(claim, table, true);
  assert.equal(result.pass, false);
  assert.ok(result.reason?.includes("Year mismatch"));
});

test("deterministicCheck: wrong title fails (empty or whitespace)", async () => {
  const paper = makePaper({ id: "arxiv:2305.11917v1", title: "   " });
  const claim = makeClaim("arxiv:2305.11917v1", "arxiv:2305.11917v1:1", "Some claim");
  const table = makeTable([claim], [paper]);
  const result = await deterministicCheck(claim, table, true);
  assert.equal(result.pass, false);
  assert.ok(result.reason?.includes("Missing or invalid title"));
});

test("deterministicCheck: missing authors fails", async () => {
  const paper = makePaper({ id: "arxiv:2305.11917v1", authors: [] });
  const claim = makeClaim("arxiv:2305.11917v1", "arxiv:2305.11917v1:1", "Some claim");
  const table = makeTable([claim], [paper]);
  const result = await deterministicCheck(claim, table, true);
  assert.equal(result.pass, false);
  assert.ok(result.reason?.includes("Missing authors"));
});

test("deterministicCheck: id not in evidence table fails", async () => {
  const paper = makePaper({ id: "arxiv:REAL100", year: 2024 });
  const claim = makeClaim("arxiv:FAKE999", "arxiv:FAKE999:1", "Made up claim");
  const table = makeTable([claim], [paper]);
  const result = await deterministicCheck(claim, table, true);
  assert.equal(result.pass, false);
  assert.ok(result.reason?.includes("not found in evidence table"));
});

test("deterministicCheck: unresolvable DOI fails", async () => {
  // Pass a known fake DOI and run with live resolution (should fail with 404 / resolution error)
  const paper = makePaper({
    id: "arxiv:2305.11917v1",
    year: 2023,
    doi: "10.99999/provenance.invalid.doi.nonexistent",
  });
  const claim = makeClaim("arxiv:2305.11917v1", "arxiv:2305.11917v1:1", "Some claim");
  const table = makeTable([claim], [paper]);
  const result = await deterministicCheck(claim, table, false); // false = check real resolution
  assert.equal(result.pass, false);
  assert.ok(result.reason?.includes("Unresolvable DOI"));
});

// ── Deduplication Tests ───────────────────────────────────────────────────────

test("deduplicatePapers: removes exact DOI duplicates", () => {
  const p1 = makePaper({ id: "arxiv:1", doi: "10.1234/test", title: "Paper A" });
  const p2 = makePaper({ id: "openalex:2", doi: "10.1234/test", title: "Paper A Alt" });
  const result = deduplicatePapers([p1, p2]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "arxiv:1");
});

test("deduplicatePapers: removes same title+year duplicates", () => {
  const p1 = makePaper({ id: "arxiv:1", title: "Neural Scaling Laws", year: 2022 });
  const p2 = makePaper({ id: "openalex:2", title: "Neural Scaling Laws", year: 2022 });
  const result = deduplicatePapers([p1, p2]);
  assert.equal(result.length, 1);
});

test("deduplicatePapers: keeps different title+year", () => {
  const p1 = makePaper({ id: "arxiv:1", title: "Attention Is All You Need", year: 2017 });
  const p2 = makePaper({ id: "arxiv:2", title: "BERT Pre-training", year: 2018 });
  const result = deduplicatePapers([p1, p2]);
  assert.equal(result.length, 2);
});

test("deduplicatePapers: keeps papers with same title but different year", () => {
  const p1 = makePaper({ id: "arxiv:1", title: "Survey on LLMs", year: 2022 });
  const p2 = makePaper({ id: "arxiv:2", title: "Survey on LLMs", year: 2023 });
  const result = deduplicatePapers([p1, p2]);
  assert.equal(result.length, 2);
});

// ── Run All Tests ─────────────────────────────────────────────────────────────

async function run() {
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
