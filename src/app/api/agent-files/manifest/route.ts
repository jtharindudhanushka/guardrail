import { NextResponse } from "next/server";
import agentPackage from "../../../../../agent-src/package.json";

export const AGENT_FILES = [
  "agent.js",
  "package.json",
  "lib/paths.js",
  "lib/log.js",
  "lib/config.js",
  "lib/portalClient.js",
  "lib/hosts.js",
  "lib/state.js",
  "lib/certs.js",
  "lib/resolve.js",
  "lib/youtubeRules.js",
  "lib/blockPage.js",
  "lib/interceptServer.js",
  "lib/selfUninstall.js",
  "lib/updater.js",
];

export async function GET() {
  return NextResponse.json({
    version: agentPackage.version || "1.1.0",
    files: AGENT_FILES,
  });
}
