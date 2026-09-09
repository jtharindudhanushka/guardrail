"use client";

import { useRef, useState } from "react";
import {
  addSiteRule,
  addYoutubeRule,
  issueBypass,
  deleteSiteRule,
  deleteYoutubeRule,
  revokeBypass,
  regeneratePairingCode,
  deleteDevice,
  updateCustomBlockPage,
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

const SAMPLE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{title}}</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: rgba(22, 27, 34, 0.85);
      --text: #f0f6fc;
      --subtext: #8b949e;
      --accent: #58a6ff;
      --border: #30363d;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at 50% 30%, #161b22, #0d1117);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 40px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(12px);
    }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent);
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 26px;
      font-weight: 700;
      margin: 0 0 12px;
      letter-spacing: -0.5px;
    }
    p.message {
      color: var(--subtext);
      font-size: 16px;
      line-height: 1.5;
      margin: 0 0 24px;
    }
    .countdown-box {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      margin-top: 10px;
    }
    .countdown-label {
      font-size: 11px;
      text-transform: uppercase;
      color: var(--subtext);
      letter-spacing: 0.8px;
    }
    .countdown-val {
      font-size: 20px;
      font-weight: 600;
      color: var(--accent);
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">{{domain}}</div>
    <h1>{{title}}</h1>
    <p class="message">{{message}}</p>
    <div class="countdown-box">
      <div class="countdown-label">Access Resets In</div>
      <div class="countdown-val">{{resetCountdown}}</div>
    </div>
  </div>
</body>
</html>`;

export function CustomBlockPageEditor({
  deviceId,
  initialHtml,
}: {
  deviceId: string;
  initialHtml: string | null;
}) {
  const [html, setHtml] = useState(initialHtml || "");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const previewHtml = (html.trim().length > 0 ? html : SAMPLE_TEMPLATE)
    .replace(/{{title}}/g, "Time's up for today")
    .replace(/{{message}}/g, "You've used your daily time limit for this site.")
    .replace(/{{domain}}/g, "instagram.com")
    .replace(/{{resetCountdown}}/g, "3h 45m 12s");

  const insertTag = (tag: string) => {
    const el = textareaRef.current;
    if (!el) {
      setHtml((prev) => prev + tag);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = html.substring(0, start) + tag + html.substring(end);
    setHtml(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
  };

  return (
    <div className="card-utility flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab("edit")}
            className={`px-3 py-1 rounded-full text-[13px] font-medium transition-colors ${
              tab === "edit"
                ? "bg-[var(--color-ink)] text-[var(--color-card)]"
                : "bg-[var(--color-canvas-parchment)] text-[var(--color-ink-muted-48)] hover:text-[var(--color-ink)]"
            }`}
          >
            HTML / CSS / JS Editor
          </button>
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={`px-3 py-1 rounded-full text-[13px] font-medium transition-colors ${
              tab === "preview"
                ? "bg-[var(--color-ink)] text-[var(--color-card)]"
                : "bg-[var(--color-canvas-parchment)] text-[var(--color-ink-muted-48)] hover:text-[var(--color-ink)]"
            }`}
          >
            Live Preview
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-[12px]">
          <span style={{ color: "var(--color-ink-muted-48)" }}>Insert:</span>
          {["{{domain}}", "{{title}}", "{{message}}", "{{resetCountdown}}"].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => insertTag(tag)}
              className="px-2 py-0.5 rounded font-mono text-[11px] bg-[var(--color-canvas-parchment)] text-[var(--color-ink)] hover:opacity-75"
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {tab === "edit" ? (
        <form
          action={async (fd) => {
            await updateCustomBlockPage(deviceId, fd);
          }}
          className="flex flex-col gap-3"
        >
          <textarea
            ref={textareaRef}
            name="customBlockHtml"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={14}
            placeholder="Leave empty to use the default clean Apple-style block page, or paste your custom <!DOCTYPE html> with <style> and <script> here..."
            className="w-full font-mono text-[13px] p-3.5 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-canvas-parchment)] text-[var(--color-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ink)] leading-relaxed"
            style={{ resize: "vertical" }}
          />

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHtml(SAMPLE_TEMPLATE)}
                className="text-[13px] text-link"
              >
                Load Modern Template
              </button>
              {html && (
                <>
                  <span style={{ color: "var(--color-hairline)" }}>•</span>
                  <button
                    type="button"
                    onClick={() => setHtml("")}
                    className="text-[13px] text-[var(--color-ink-muted-48)] hover:text-[var(--color-ink)]"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button className="btn-primary text-[14px]" type="submit">
                Save Block Page
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="rounded-xl overflow-hidden border border-[var(--color-hairline)] bg-black h-[420px]">
            <iframe
              srcDoc={previewHtml}
              title="Custom Block Page Preview"
              className="w-full h-full border-0"
              sandbox="allow-scripts"
            />
          </div>
          <p className="text-[12px] text-center" style={{ color: "var(--color-ink-muted-48)" }}>
            Preview rendered with sample data: <code>instagram.com</code>, <code>Time&apos;s up for today</code>, and <code>3h 45m 12s</code>
          </p>
        </div>
      )}
    </div>
  );
}

