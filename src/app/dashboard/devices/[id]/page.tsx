import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import type { SiteRule, YoutubeRule, BypassCode } from "@/generated/prisma/client";
import {
  SiteRuleForm,
  DeleteSiteRuleButton,
  YoutubeRuleForm,
  DeleteYoutubeRuleButton,
  BypassForm,
  RevokeBypassButton,
  RegenerateCodeButton,
} from "./forms";

const ONLINE_WINDOW_MS = 45_000;

export default async function DeviceDetailPage({ params }: PageProps<"/dashboard/devices/[id]">) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const device = await prisma.device.findFirst({
    where: { id, ownerId: userId },
    include: {
      siteRules: { orderBy: { domain: "asc" } },
      youtubeRules: { orderBy: { createdAt: "desc" } },
      bypasses: { where: { expiresAt: { gt: new Date() } }, orderBy: { expiresAt: "desc" } },
    },
  });
  if (!device) notFound();

  const hdrs = await headers();
  const origin = `${hdrs.get("x-forwarded-proto") ?? "http"}://${hdrs.get("host")}`;

  // eslint-disable-next-line react-hooks/purity -- Server Component, computed once per request, not re-rendered client-side
  const online = device.lastSeenAt ? Date.now() - device.lastSeenAt.getTime() < ONLINE_WINDOW_MS : false;

  return (
    <div className="flex flex-col gap-10">
      <div>
        <Link href="/dashboard" className="text-[14px] text-link">
          ← Devices
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-[34px] font-semibold tracking-[-0.374px]" style={{ color: "var(--color-ink)" }}>
            {device.name}
          </h1>
          <span
            className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full"
            style={{
              background: device.pairedAt ? (online ? "rgba(52,199,89,0.12)" : "rgba(255,59,48,0.12)") : "var(--color-hairline)",
              color: device.pairedAt ? (online ? "#248a3d" : "#c0392b") : "var(--color-ink-muted-48)",
            }}
          >
            {device.pairedAt ? (online ? "Online" : "Offline") : "Not paired"}
          </span>
        </div>
      </div>

      {!device.pairedAt && (
        <section className="card-utility">
          <p className="text-[17px] font-semibold mb-2" style={{ color: "var(--color-ink)" }}>
            Install on the laptop
          </p>
          <p className="text-[14px] mb-4" style={{ color: "var(--color-ink-muted-48)" }}>
            On the laptop, open PowerShell and run this one line. It downloads and pairs automatically with the code
            below — no other setup.
          </p>
          <InstallCommand code={device.pairingCode!} origin={origin} />
          <div className="mt-3">
            <RegenerateCodeButton deviceId={device.id} />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-[21px] font-semibold tracking-[0.231px] mb-1" style={{ color: "var(--color-ink)" }}>
          Site time budgets
        </h2>
        <p className="text-[14px] mb-4" style={{ color: "var(--color-ink-muted-48)" }}>
          Each site gets its own daily minutes, reset at midnight.
        </p>
        <div className="card-utility flex flex-col gap-4">
          <SiteRuleForm deviceId={device.id} />
          {device.siteRules.length > 0 && (
            <div className="flex flex-col divide-y" style={{ borderColor: "var(--color-hairline)" }}>
              {device.siteRules.map((r: SiteRule) => (
                <div key={r.id} className="flex items-center justify-between py-3" style={{ borderTop: "1px solid var(--color-hairline)" }}>
                  <span className="text-[17px]" style={{ color: "var(--color-ink)" }}>
                    {r.domain}
                  </span>
                  <div className="flex items-center gap-4">
                    <span className="text-[14px]" style={{ color: "var(--color-ink-muted-48)" }}>
                      {r.dailyLimitMinutes} min/day
                    </span>
                    <DeleteSiteRuleButton deviceId={device.id} siteRuleId={r.id} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-[21px] font-semibold tracking-[0.231px] mb-1" style={{ color: "var(--color-ink)" }}>
          YouTube whitelist
        </h2>
        <p className="text-[14px] mb-4" style={{ color: "var(--color-ink-muted-48)" }}>
          Only whitelisted videos, channels, or playlists will play. Everything else on YouTube is blocked.
        </p>
        <div className="card-utility flex flex-col gap-4">
          <YoutubeRuleForm deviceId={device.id} />
          {device.youtubeRules.length > 0 && (
            <div className="flex flex-col">
              {device.youtubeRules.map((r: YoutubeRule) => (
                <div key={r.id} className="flex items-center justify-between py-3" style={{ borderTop: "1px solid var(--color-hairline)" }}>
                  <div>
                    <span
                      className="text-[12px] uppercase mr-2 px-2 py-0.5 rounded-full"
                      style={{ background: "var(--color-canvas-parchment)", color: "var(--color-ink-muted-48)" }}
                    >
                      {r.type}
                    </span>
                    <span className="text-[17px]" style={{ color: "var(--color-ink)" }}>
                      {r.label || r.value}
                    </span>
                  </div>
                  <DeleteYoutubeRuleButton deviceId={device.id} youtubeRuleId={r.id} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-[21px] font-semibold tracking-[0.231px] mb-1" style={{ color: "var(--color-ink)" }}>
          Bypass
        </h2>
        <p className="text-[14px] mb-4" style={{ color: "var(--color-ink-muted-48)" }}>
          Grant a temporary unlock when asked. It expires on its own.
        </p>
        <div className="card-utility flex flex-col gap-4">
          <BypassForm deviceId={device.id} />
          {device.bypasses.length > 0 && (
            <div className="flex flex-col">
              {device.bypasses.map((b: BypassCode) => (
                <div key={b.id} className="flex items-center justify-between py-3" style={{ borderTop: "1px solid var(--color-hairline)" }}>
                  <span className="text-[17px]" style={{ color: "var(--color-ink)" }}>
                    {b.domain || "All social sites"} — until {new Date(b.expiresAt).toLocaleTimeString()}
                  </span>
                  <RevokeBypassButton deviceId={device.id} bypassId={b.id} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function InstallCommand({ code, origin }: { code: string; origin: string }) {
  return (
    <div
      className="text-[14px] font-mono p-4 rounded-[8px] break-all"
      style={{ background: "var(--color-ink)", color: "#ffffff" }}
    >
      irm &quot;{origin}/api/install?code={code}&quot; | iex
    </div>
  );
}
