import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const code = String(body?.code || "")
    .trim()
    .toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "Missing pairing code" }, { status: 400 });
  }

  const device = await prisma.device.findFirst({ where: { pairingCode: code } });
  if (!device) {
    return NextResponse.json({ error: "Invalid or already-used pairing code" }, { status: 404 });
  }

  const updated = await prisma.device.update({
    where: { id: device.id },
    data: { pairingCode: null, pairedAt: new Date(), lastSeenAt: new Date() },
  });

  return NextResponse.json({ deviceId: updated.id, apiKey: updated.apiKey, deviceName: updated.name });
}
