import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/agentAuth";
import type { SiteRule, YoutubeRule, BypassCode } from "@/generated/prisma/client";

export async function GET(req: NextRequest) {
  const device = await authenticateAgent(req);
  if (!device) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  await prisma.device.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() },
  });

  const [siteRules, youtubeRules, bypasses] = await Promise.all([
    prisma.siteRule.findMany({ where: { deviceId: device.id, enabled: true } }),
    prisma.youtubeRule.findMany({ where: { deviceId: device.id } }),
    prisma.bypassCode.findMany({ where: { deviceId: device.id, expiresAt: { gt: new Date() } } }),
  ]);

  return NextResponse.json({
    deviceName: device.name,
    serverTime: new Date().toISOString(),
    siteRules: siteRules.map((r: SiteRule) => ({ domain: r.domain, dailyLimitMinutes: r.dailyLimitMinutes })),
    youtubeRules: youtubeRules.map((r: YoutubeRule) => ({ type: r.type, value: r.value })),
    bypasses: bypasses.map((b: BypassCode) => ({ domain: b.domain, expiresAt: b.expiresAt.toISOString() })),
  });
}
