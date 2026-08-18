import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

const AGENT_SRC_ROOT = path.join(process.cwd(), "agent-src");

export async function GET(_req: Request, { params }: RouteContext<"/api/agent-files/[...file]">) {
  const { file } = await params;
  const relPath = file.join("/");

  const resolved = path.normalize(path.join(AGENT_SRC_ROOT, relPath));
  if (!resolved.startsWith(AGENT_SRC_ROOT)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const content = await fs.readFile(resolved, "utf8");
    return new NextResponse(content, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
