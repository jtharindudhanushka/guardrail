const { readConfig, writeConfig } = require("./lib/config");
const { applyBlockedDomains } = require("./lib/hosts");
const { localDateKey, loadState, saveState } = require("./lib/state");
const portalClient = require("./lib/portalClient");
const interceptServer = require("./lib/interceptServer");
const { ensureCA } = require("./lib/certs");
const { log } = require("./lib/log");

const POLL_INTERVAL_MS = 15_000;
const YOUTUBE_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtubei.googleapis.com"];

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  });
  return args;
}

async function ensurePaired(config) {
  if (config.apiKey && config.deviceId) return config;

  const code = config.pairingCode || parseArgs().code;
  const portalUrl = config.portalUrl || parseArgs().portal;
  if (!code || !portalUrl) {
    throw new Error("Not paired: missing pairing code or portal URL. Run with --code=XXXX --portal=https://...");
  }

  log(`Pairing with ${portalUrl} using code ${code}...`);
  const result = await portalClient.pair(portalUrl, code);
  const next = { ...config, portalUrl, deviceId: result.deviceId, apiKey: result.apiKey, deviceName: result.deviceName };
  writeConfig(next);
  log(`Paired as device "${result.deviceName}" (${result.deviceId})`);
  return next;
}

function bypassCoversDomain(bypasses, domain) {
  const now = Date.now();
  return bypasses.some((b) => new Date(b.expiresAt).getTime() > now && (b.domain === null || b.domain === domain));
}

async function tick(config) {
  const rules = await portalClient.fetchRules(config.portalUrl, config.apiKey);
  const state = loadState();

  const blockedDomains = [];
  const usageReport = [];

  for (const rule of rules.siteRules) {
    const bypassed = bypassCoversDomain(rules.bypasses, rule.domain);
    const usedSeconds = state.usage[rule.domain] || 0;
    const overBudget = usedSeconds >= rule.dailyLimitMinutes * 60;

    if (bypassed || !overBudget) {
      if (!bypassed) {
        state.usage[rule.domain] = usedSeconds + POLL_INTERVAL_MS / 1000;
      }
    } else {
      blockedDomains.push(rule.domain);
    }
    usageReport.push({ domain: rule.domain, dateKey: state.dateKey, elapsedSeconds: Math.round(state.usage[rule.domain] || 0) });
  }

  saveState(state);
  applyBlockedDomains([...blockedDomains, ...YOUTUBE_HOSTS]);

  interceptServer.setBlockedDomains(blockedDomains);
  interceptServer.setYoutubeRules(rules.youtubeRules);

  await portalClient.reportUsage(config.portalUrl, config.apiKey, usageReport).catch((e) => log("usage report failed:", e.message));

  log(`tick ok — blocked: [${blockedDomains.join(", ") || "none"}], youtube rules: ${rules.youtubeRules.length}`);
}

// Leaving hosts entries behind while nothing is listening on 127.0.0.1 makes every
// affected site fail with ERR_CONNECTION_REFUSED, which looks like "the internet is
// broken" rather than a block. Always fail open.
let cleanedUp = false;
function releaseAllBlocks(reason) {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    applyBlockedDomains([]);
    log(`Released all hosts-file blocks (${reason}).`);
  } catch (e) {
    log(`Failed to release hosts-file blocks (${reason}):`, e.message);
  }
}

function installCleanupHandlers() {
  const bye = (reason) => () => {
    releaseAllBlocks(reason);
    process.exit(0);
  };
  process.on("SIGINT", bye("SIGINT"));
  process.on("SIGTERM", bye("SIGTERM"));
  process.on("SIGHUP", bye("SIGHUP"));
  process.on("exit", () => releaseAllBlocks("exit"));
  process.on("uncaughtException", (e) => {
    log("Uncaught exception:", e.stack || e.message);
    releaseAllBlocks("uncaughtException");
    process.exit(1);
  });
  process.on("unhandledRejection", (e) => {
    log("Unhandled rejection:", (e && e.stack) || String(e));
  });
}

async function main() {
  const args = parseArgs();

  if (args["generate-ca"]) {
    ensureCA();
    log("CA ready.");
    process.exit(0);
  }

  let config = readConfig();
  if (args.code) config.pairingCode = args.code;
  if (args.portal) config.portalUrl = args.portal;

  config = await ensurePaired(config);

  // Bind the intercept server BEFORE writing any hosts entries. If it can't bind
  // (port 443 already in use, insufficient privileges), enforce nothing rather than
  // black-holing traffic to a dead local port.
  try {
    await interceptServer.start();
  } catch (e) {
    log("FATAL: could not start the intercept server —", e.message);
    log("Enforcement disabled and all blocks released so browsing still works.");
    releaseAllBlocks("intercept server failed to bind");
    process.exit(1);
  }

  installCleanupHandlers();

  // Always gate YouTube regardless of budgets - the whitelist is a standing policy.
  applyBlockedDomains(YOUTUBE_HOSTS);

  const loop = async () => {
    try {
      await tick(config);
    } catch (e) {
      log("tick error:", e.message);
    }
    setTimeout(loop, POLL_INTERVAL_MS);
  };
  loop();
}

main().catch((e) => {
  log("Fatal:", e.stack || e.message);
  releaseAllBlocks("fatal error");
  process.exit(1);
});
