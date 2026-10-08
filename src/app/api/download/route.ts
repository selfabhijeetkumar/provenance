/**
 * GET /api/download?runId=<uuid>
 * Serves the generated paper.md for browser download.
 */

import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId") ?? "";
  if (!runId || !/^[a-f0-9-]{36}$/.test(runId)) {
    return NextResponse.json({ error: "invalid runId" }, { status: 400 });
  }

  const filePath = join(process.cwd(), "runs", runId, "paper.md");
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const content = readFileSync(filePath, "utf-8");
  return new Response(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="provenance-${runId.slice(0, 8)}.md"`,
    },
  });
}
