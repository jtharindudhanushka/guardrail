"use client";

import { useRef } from "react";
import {
  addSiteRule,
  addYoutubeRule,
  issueBypass,
  deleteSiteRule,
  deleteYoutubeRule,
  revokeBypass,
  regeneratePairingCode,
  deleteDevice,
} from "../../actions";

export function SiteRuleForm({ deviceId }: { deviceId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await addSiteRule(deviceId, fd);
        formRef.current?.reset();
      }}
      className="flex gap-2 flex-wrap"
    >
      <input className="input-pill" name="domain" placeholder="instagram.com" style={{ maxWidth: 220 }} required />
      <input
        className="input-pill"
        name="dailyLimitMinutes"
        type="number"
        min={1}
        placeholder="Minutes/day"
        style={{ maxWidth: 140 }}
        required
      />
      <button className="btn-secondary-pill" type="submit">
        Add
      </button>
    </form>
  );
}

export function DeleteSiteRuleButton({ deviceId, siteRuleId }: { deviceId: string; siteRuleId: string }) {
  return (
    <form action={async () => await deleteSiteRule(deviceId, siteRuleId)}>
      <button className="text-[14px] text-link" type="submit">
        Remove
      </button>
    </form>
  );
}

export function YoutubeRuleForm({ deviceId }: { deviceId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await addYoutubeRule(deviceId, fd);
        formRef.current?.reset();
      }}
      className="flex gap-2 flex-wrap items-center"
    >
      <select className="input-pill" name="type" style={{ maxWidth: 140 }}>
        <option value="VIDEO">Video</option>
        <option value="CHANNEL">Channel</option>
        <option value="PLAYLIST">Playlist</option>
      </select>
      <input
        className="input-pill"
        name="value"
        placeholder="Paste a YouTube URL or ID"
        style={{ maxWidth: 320 }}
        required
      />
      <input className="input-pill" name="label" placeholder="Label (optional)" style={{ maxWidth: 180 }} />
      <button className="btn-secondary-pill" type="submit">
        Whitelist
      </button>
    </form>
  );
}

export function DeleteYoutubeRuleButton({ deviceId, youtubeRuleId }: { deviceId: string; youtubeRuleId: string }) {
  return (
    <form action={async () => await deleteYoutubeRule(deviceId, youtubeRuleId)}>
      <button className="text-[14px] text-link" type="submit">
        Remove
      </button>
    </form>
  );
}

export function BypassForm({ deviceId }: { deviceId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await issueBypass(deviceId, fd);
        formRef.current?.reset();
      }}
      className="flex gap-2 flex-wrap"
    >
      <input
        className="input-pill"
        name="domain"
        placeholder="Domain (blank = all social sites)"
        style={{ maxWidth: 260 }}
      />
      <input className="input-pill" name="minutes" type="number" min={1} placeholder="Minutes" style={{ maxWidth: 120 }} required />
      <button className="btn-primary" type="submit">
        Unlock
      </button>
    </form>
  );
}

export function RevokeBypassButton({ deviceId, bypassId }: { deviceId: string; bypassId: string }) {
  return (
    <form action={async () => await revokeBypass(deviceId, bypassId)}>
      <button className="text-[14px] text-link" type="submit">
        Revoke
      </button>
    </form>
  );
}

export function DeleteDeviceButton({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  return (
    <form
      action={async () => {
        await deleteDevice(deviceId);
      }}
      onSubmit={(e) => {
        const ok = window.confirm(
          `Remove "${deviceName}"?\n\nAll its limits and whitelist entries will be deleted, and Guardrail will uninstall itself from that laptop the next time the agent checks in.`
        );
        if (!ok) e.preventDefault();
      }}
    >
      <button className="btn-secondary-pill" type="submit">
        Remove this device
      </button>
    </form>
  );
}

export function RegenerateCodeButton({ deviceId }: { deviceId: string }) {
  return (
    <form action={async () => await regeneratePairingCode(deviceId)}>
      <button className="btn-secondary-pill" type="submit">
        Generate new pairing code
      </button>
    </form>
  );
}
