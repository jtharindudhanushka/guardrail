// Routing rules for the intercept server, exercised without network access.
// Run with: node test/routing.test.js
const assert = require("assert");
const path = require("path");

// Force a scratch data dir so the test never touches the real CA or ProgramData.
process.env.GUARDRAIL_DATA_DIR = path.join(__dirname, ".tmp-testdata");

// Stub DNS resolution so a "passthrough" decision fails fast and is distinguishable
// from a block-page decision (502 vs. HTML body).
const resolve = require("../lib/resolve");
resolve.resolveReal = () => Promise.reject(new Error("stubbed"));

const interceptServer = require("../lib/interceptServer");

function makeReq({ host, url, dest = "document" }) {
  return { headers: { host, "sec-fetch-dest": dest, accept: "text/html" }, url, method: "GET", on: () => {}, pipe: () => {} };
}

function run(req) {
  return new Promise((resolve) => {
    let status = null;
    let body = "";
    const res = {
      writeHead: (s) => { status = s; },
      end: (chunk) => { body = chunk || ""; resolve({ status, body }); },
    };
    interceptServer.requestHandler(req, res);
  });
}

const PASSTHROUGH = "DNS resolution failed"; // proxyPassthrough reached, then stubbed DNS failed

(async () => {
  // youtube.com is over its daily budget, and one video is whitelisted.
  interceptServer.setBlockedDomains(["youtube.com", "instagram.com"]);
  interceptServer.setYoutubeRules([{ type: "VIDEO", value: "APPROVED123" }]);

  let r = await run(makeReq({ host: "www.youtube.com", url: "/watch?v=APPROVED123" }));
  assert(r.body.includes(PASSTHROUGH), "whitelisted video must play even when the budget is exhausted");
  console.log("PASS  whitelisted video plays despite exhausted youtube.com budget");

  r = await run(makeReq({ host: "www.youtube.com", url: "/watch?v=NOTAPPROVED" }));
  assert(r.body.includes("Not on the whitelist"), "non-whitelisted video must show the whitelist page");
  console.log("PASS  non-whitelisted video shows the whitelist block page");

  r = await run(makeReq({ host: "www.youtube.com", url: "/" }));
  assert(r.body.includes("Time&#39;s up") || r.body.includes("Time's up"), "browsing must respect the budget");
  console.log("PASS  general YouTube browsing blocked once the budget is exhausted");

  r = await run(makeReq({ host: "www.youtube.com", url: "/s/player/abc/base.js", dest: "script" }));
  assert(r.body.includes(PASSTHROUGH), "sub-resources must never receive an HTML block page");
  console.log("PASS  sub-resources pass through so approved playback isn't broken");

  r = await run(makeReq({ host: "www.instagram.com", url: "/" }));
  assert(r.body.includes("Time's up"), "a plain over-budget site must show the time-up page");
  console.log("PASS  non-YouTube site over budget shows the time-up page");

  // With no budget on youtube.com, the whitelist alone still governs playback.
  interceptServer.setBlockedDomains([]);
  r = await run(makeReq({ host: "www.youtube.com", url: "/watch?v=NOTAPPROVED" }));
  assert(r.body.includes("Not on the whitelist"), "whitelist applies even with no time budget set");
  console.log("PASS  whitelist still gates playback with no youtube.com budget");

  r = await run(makeReq({ host: "www.youtube.com", url: "/" }));
  assert(r.body.includes(PASSTHROUGH), "browsing allowed when under budget");
  console.log("PASS  browsing allowed while under budget");

  console.log("\nAll routing tests passed.");
})();
