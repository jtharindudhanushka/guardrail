// Routing rules for the intercept server, exercised without network access.
// Run with: node test/routing.test.js
const assert = require("assert");
const path = require("path");

// Force a scratch data dir so the test never touches the real CA or ProgramData.
process.env.GUARDRAIL_DATA_DIR = path.join(__dirname, ".tmp-testdata");

// Stub DNS resolution so a "passthrough" decision fails fast and is distinguishable
// from a block-page decision (502 vs. HTML body). Never hits the network.
const dns = require("../lib/resolve");
dns.resolveReal = () => Promise.reject(new Error("stubbed"));

const interceptServer = require("../lib/interceptServer");

function makeReq({ host, url, dest = "document" }) {
  return {
    headers: { host, "sec-fetch-dest": dest, accept: "text/html" },
    url,
    method: "GET",
    on: () => {},
    pipe: () => {},
  };
}

function run(req) {
  return new Promise((resolve) => {
    let status = null;
    let body = "";
    const res = {
      headersSent: false,
      writableEnded: false,
      on: () => {},
      destroy: () => resolve({ status, body }),
      writeHead: (s) => { status = s; res.headersSent = true; },
      end: (chunk) => { body = chunk || ""; res.writableEnded = true; resolve({ status, body }); },
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

  // Playlist Whitelist Tests
  interceptServer.setBlockedDomains(["youtube.com"]);
  interceptServer.setYoutubeRules([{ type: "PLAYLIST", value: "PLAPPROVED123" }]);

  // 1. Full page video load with whitelisted playlist
  r = await run(makeReq({ host: "www.youtube.com", url: "/watch?v=RANDOMVID&list=PLAPPROVED123" }));
  assert(r.body.includes(PASSTHROUGH), "video with whitelisted playlist must play even when budget is exhausted");
  console.log("PASS  video with whitelisted playlist plays despite exhausted youtube.com budget");

  // 2. Full page video load with non-whitelisted playlist
  r = await run(makeReq({ host: "www.youtube.com", url: "/watch?v=RANDOMVID&list=PLOTHER" }));
  assert(r.body.includes("Not on the whitelist"), "video with non-whitelisted playlist must be blocked");
  console.log("PASS  video with non-whitelisted playlist is blocked");

  // 3. Whitelisted playlist page itself allowed when over budget
  r = await run(makeReq({ host: "www.youtube.com", url: "/playlist?list=PLAPPROVED123" }));
  assert(r.body.includes(PASSTHROUGH), "whitelisted playlist page allowed despite exhausted youtube.com budget");
  console.log("PASS  whitelisted playlist page allowed despite exhausted budget");

  // 4. Non-whitelisted playlist page blocked when over budget
  r = await run(makeReq({ host: "www.youtube.com", url: "/playlist?list=PLOTHER" }));
  assert(r.body.includes("Time&#39;s up") || r.body.includes("Time's up"), "non-whitelisted playlist page blocked when over budget");
  console.log("PASS  non-whitelisted playlist page blocked when over budget");

  // 5. Player API calls with playlistId (SPA navigation)
  function makeApiReq({ host = "www.youtube.com", url = "/youtubei/v1/player", body }) {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    return {
      headers: { host, "content-type": "application/json" },
      url,
      method: "POST",
      on: (evt, fn) => {
        if (evt === "data") setTimeout(() => fn(Buffer.from(bodyStr)), 0);
        if (evt === "end") setTimeout(() => fn(), 5);
      },
      pipe: () => {},
    };
  }

  r = await run(makeApiReq({ body: { videoId: "RANDOMVID", playlistId: "PLAPPROVED123" } }));
  assert(r.body.includes(PASSTHROUGH), "player API call with whitelisted playlistId must pass through");
  console.log("PASS  player API call with whitelisted playlistId passes through");

  r = await run(makeApiReq({ body: { videoId: "RANDOMVID", playlistId: "PLOTHER" } }));
  assert(r.body.includes("not on your approved Guardrail whitelist"), "player API call with non-whitelisted playlistId must return blocked playabilityStatus");
  console.log("PASS  player API call with non-whitelisted playlistId returns blocked playabilityStatus");

  // 6. Next API calls (/youtubei/v1/next)
  r = await run(makeApiReq({ url: "/youtubei/v1/next", body: { videoId: "RANDOMVID", playlistId: "PLAPPROVED123" } }));
  assert(r.body.includes(PASSTHROUGH), "next API call with whitelisted playlistId must pass through");
  console.log("PASS  next API call with whitelisted playlistId passes through");

  r = await run(makeApiReq({ url: "/youtubei/v1/next", body: { videoId: "RANDOMVID", playlistId: "PLOTHER" } }));
  assert(r.body.includes("contents") && !r.body.includes(PASSTHROUGH), "next API call with non-whitelisted playlistId must return empty contents");
  console.log("PASS  next API call with non-whitelisted playlistId returns empty contents");


  // Custom block HTML tests
  interceptServer.setBlockedDomains(["instagram.com"]);
  interceptServer.setCustomBlockHtml("<div class='custom'>Blocked {{domain}} - {{title}}</div>");
  r = await run(makeReq({ host: "instagram.com", url: "/" }));
  assert(r.body.includes("<div class='custom'>Blocked instagram.com - Time's up for today</div>"), "custom block page renders with interpolated variables");
  console.log("PASS  custom block page renders with interpolated variables");

  // Clearing custom block HTML restores default template
  interceptServer.setCustomBlockHtml(null);
  r = await run(makeReq({ host: "instagram.com", url: "/" }));
  assert(r.body.includes("Time's up for today") && r.body.includes("glyph"), "clearing custom block HTML restores default Apple-style page");
  console.log("PASS  clearing custom block HTML restores default page");

  console.log("\nAll routing tests passed.");
})();

