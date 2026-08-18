"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { generateApiKey, generatePairingCode } from "@/lib/ids";

async function requireUserId() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  return userId;
}

async function assertOwnsDevice(userId: string, deviceId: string) {
  const device = await prisma.device.findFirst({ where: { id: deviceId, ownerId: userId } });
  if (!device) throw new Error("Device not found");
  return device;
}

export async function createDevice(
  _prevState: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  const userId = await requireUserId();
  const name = String(formData.get("name") || "").trim() || "New device";

  await prisma.device.create({
    data: {
      name,
      ownerId: userId,
      apiKey: generateApiKey(),
      pairingCode: generatePairingCode(),
    },
  });

  revalidatePath("/dashboard");
  return undefined;
}

export async function regeneratePairingCode(deviceId: string) {
  const userId = await requireUserId();
  await assertOwnsDevice(userId, deviceId);
  await prisma.device.update({
    where: { id: deviceId },
    data: { pairingCode: generatePairingCode(), pairedAt: null },
  });
  revalidatePath(`/dashboard/devices/${deviceId}`);
}

export async function addSiteRule(deviceId: string, formData: FormData) {
  const userId = await requireUserId();
  await assertOwnsDevice(userId, deviceId);

  const domain = String(formData.get("domain") || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const dailyLimitMinutes = Number(formData.get("dailyLimitMinutes") || 0);

  if (!domain || dailyLimitMinutes <= 0) return;

  await prisma.siteRule.upsert({
    where: { deviceId_domain: { deviceId, domain } },
    update: { dailyLimitMinutes, enabled: true },
    create: { deviceId, domain, dailyLimitMinutes },
  });

  revalidatePath(`/dashboard/devices/${deviceId}`);
}

export async function deleteSiteRule(deviceId: string, siteRuleId: string) {
  const userId = await requireUserId();
  await assertOwnsDevice(userId, deviceId);
  await prisma.siteRule.delete({ where: { id: siteRuleId } });
  revalidatePath(`/dashboard/devices/${deviceId}`);
}

export async function addYoutubeRule(deviceId: string, formData: FormData) {
  const userId = await requireUserId();
  await assertOwnsDevice(userId, deviceId);

  const type = String(formData.get("type") || "VIDEO") as "VIDEO" | "CHANNEL" | "PLAYLIST";
  const rawValue = String(formData.get("value") || "").trim();
  const label = String(formData.get("label") || "").trim() || null;
  if (!rawValue) return;

  const value = extractYoutubeIdentifier(rawValue, type);

  await prisma.youtubeRule.upsert({
    where: { deviceId_type_value: { deviceId, type, value } },
    update: { label },
    create: { deviceId, type, value, label },
  });

  revalidatePath(`/dashboard/devices/${deviceId}`);
}

export async function deleteYoutubeRule(deviceId: string, youtubeRuleId: string) {
  const userId = await requireUserId();
  await assertOwnsDevice(userId, deviceId);
  await prisma.youtubeRule.delete({ where: { id: youtubeRuleId } });
  revalidatePath(`/dashboard/devices/${deviceId}`);
}

export async function issueBypass(deviceId: string, formData: FormData) {
  const userId = await requireUserId();
  await assertOwnsDevice(userId, deviceId);

  const minutes = Number(formData.get("minutes") || 0);
  const domain = String(formData.get("domain") || "").trim().toLowerCase() || null;
  if (minutes <= 0) return;

  const expiresAt = new Date(Date.now() + minutes * 60_000);

  await prisma.bypassCode.create({
    data: { deviceId, domain, minutes, expiresAt },
  });

  revalidatePath(`/dashboard/devices/${deviceId}`);
}

export async function revokeBypass(deviceId: string, bypassId: string) {
  const userId = await requireUserId();
  await assertOwnsDevice(userId, deviceId);
  await prisma.bypassCode.update({
    where: { id: bypassId },
    data: { expiresAt: new Date(0) },
  });
  revalidatePath(`/dashboard/devices/${deviceId}`);
}

// Accepts full YouTube URLs or bare IDs/handles and pulls out the identifier we match on.
function extractYoutubeIdentifier(input: string, type: "VIDEO" | "CHANNEL" | "PLAYLIST"): string {
  try {
    const url = new URL(input);
    if (type === "VIDEO") {
      if (url.hostname.includes("youtu.be")) return url.pathname.slice(1);
      const v = url.searchParams.get("v");
      if (v) return v;
      const shorts = url.pathname.match(/\/shorts\/([^/]+)/);
      if (shorts) return shorts[1];
    }
    if (type === "PLAYLIST") {
      const list = url.searchParams.get("list");
      if (list) return list;
    }
    if (type === "CHANNEL") {
      const channelMatch = url.pathname.match(/\/channel\/([^/]+)/);
      if (channelMatch) return channelMatch[1];
      const handleMatch = url.pathname.match(/\/@([^/]+)/);
      if (handleMatch) return `@${handleMatch[1]}`;
    }
    return input;
  } catch {
    return input; // not a URL, treat as a raw ID/handle already
  }
}
