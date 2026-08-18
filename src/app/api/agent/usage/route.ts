import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/agentAuth";

// Agent reports aggregate elapsed-seconds per site per local day. No URLs or video titles ever sent.
export async function POST(req: NextRequest) {
  const device = await authenticateAgent(req);
  if (!device) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const entries: { domain: string; dateKey: string; elapsedSeconds: number }[] = body?.usage || [];

  await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });

  for (const entry of entries) {
    if (!entry.domain || !entry.dateKey) continue;
    await prisma.usageState.upsert({
      where: { deviceId_domain_dateKey: { deviceId: device.id, domain: entry.domain, dateKey: entry.dateKey } },
      update: { elapsedSeconds: Math.max(0, Math.floor(entry.elapsedSeconds || 0)) },
      create: {
        deviceId: device.id,
        domain: entry.domain,
        dateKey: entry.dateKey,
        elapsedSeconds: Math.max(0, Math.floor(entry.elapsedSeconds || 0)),
      },
    });
  }

  return NextResponse.json({ ok: true });
}
