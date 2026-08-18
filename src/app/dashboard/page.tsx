import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import AddDeviceForm from "./AddDeviceForm";
import type { Device } from "@/generated/prisma/client";

const ONLINE_WINDOW_MS = 45_000; // agent heartbeats every ~15-20s

export default async function DashboardPage() {
  const userId = await getCurrentUserId();
  const devices = await prisma.device.findMany({
    where: { ownerId: userId! },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-[34px] font-semibold tracking-[-0.374px] mb-2" style={{ color: "var(--color-ink)" }}>
        Devices
      </h1>
      <p className="text-[17px] mb-8" style={{ color: "var(--color-ink-muted-48)" }}>
        Pair a laptop, then set limits and manage bypasses from here.
      </p>

      <div className="card-utility mb-10">
        <p className="text-[14px] font-semibold mb-3" style={{ color: "var(--color-ink)" }}>
          Add a new device
        </p>
        <AddDeviceForm />
      </div>

      <div className="flex flex-col gap-3">
        {devices.length === 0 && (
          <p className="text-[14px]" style={{ color: "var(--color-ink-muted-48)" }}>
            No devices yet. Add one above, then run the installer on that laptop with its pairing code.
          </p>
        )}

        {devices.map((d: Device) => {
          const online = d.lastSeenAt ? Date.now() - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS : false;
          return (
            <Link
              key={d.id}
              href={`/dashboard/devices/${d.id}`}
              className="card-utility flex items-center justify-between hover:bg-[var(--color-surface-pearl)] transition-colors"
            >
              <div>
                <p className="text-[17px] font-semibold" style={{ color: "var(--color-ink)" }}>
                  {d.name}
                </p>
                <p className="text-[14px]" style={{ color: "var(--color-ink-muted-48)" }}>
                  {d.pairedAt ? (online ? "Online" : "Offline") : `Not paired — code ${d.pairingCode}`}
                </p>
              </div>
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: d.pairedAt ? (online ? "#34c759" : "#ff3b30") : "#d2d2d7" }}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
