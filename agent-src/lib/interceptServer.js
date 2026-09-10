const https = require("https");
const http = require("http");
const tls = require("tls");
const { URL } = require("url");
const { ensureCA, getLeafCert } = require("./certs");
// Imported as a namespace rather than destructured so tests can substitute
// resolveReal - a destructured binding captures the original function forever.
const dns = require("./resolve");
const { isAllowed, extractVideoId } = require("./youtubeRules");
const { blockPageHtml } = require("./blockPage");
const { log } = require("./log");

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const YOUTUBE_API_HOSTS = new Set(["youtubei.googleapis.com"]);

let currentYoutubeRules = [];
let currentBlockedDomains = new Set();
let currentCustomBlockHtml = null;

function setYoutubeRules(rules) {
  currentYoutubeRules = rules;
}
function setBlockedDomains(domains) {
  currentBlockedDomains = new Set(domains);
}
function setCustomBlockHtml(html) {
  currentCustomBlockHtml = html || null;
}

function isBlockedSocialHost(hostname) {
  const bare = hostname.replace(/^www\./, "");
  return currentBlockedDomains.has(bare) || currentBlockedDomains.has(hostname);
}

// An upstream can fail *after* we've already started streaming its response, at which
// point writeHead throws ERR_HTTP_HEADERS_SENT. Unhandled, that takes the whole agent
// down over a single dropped request - so every failure path goes through here.
function failResponse(res, status, message) {
  if (res.headersSent || res.writableEnded) {
    res.destroy();
    return;
  }
  try {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(message);
  } catch {
    res.destroy();
  }
}

// Client aborts (closing a tab mid-load) surface as stream errors. They're routine,
// not exceptional - swallow them rather than letting them reach uncaughtException.
function ignoreStreamErrors(...streams) {
  for (const s of streams) {
    if (s && typeof s.on === "function") s.on("error", () => {});
  }
}

const YOUTUBE_INJECTION = `
<style id="guardrail-distraction-free">
  #related,
  ytd-watch-next-secondary-results-renderer,
  .ytp-endscreen-content,
  .ytp-ce-element,
  .ytp-ce-video,
  .ytp-ce-playlist,
  .ytp-ce-channel,
  .ytp-ce-covering-overlay,
  .ytp-cards-teaser,
  ytd-shelf-renderer,
  ytd-reel-shelf-renderer {
    display: none !important;
  }
  ytd-watch-flexy:not([theater]):not([fullscreen]) #primary.ytd-watch-flexy {
    max-width: 1280px !important;
    margin: 0 auto !important;
  }
</style>
<script id="guardrail-spa-guard">
  (function() {
    function disableAutoplay() {
      var btn = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
      if (btn) btn.click();
    }
    setInterval(disableAutoplay, 1500);

    // Intercept clicks on links that lead to videos to force full top-level navigation
    document.addEventListener('click', function(e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a && a.href) {
        var h = a.href;
        if (h.indexOf('/watch') !== -1 || h.indexOf('/shorts/') !== -1) {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = h;
        }
      }
    }, true);

    // Intercept SPA pushState to prevent background client-side navigation
    var origPush = history.pushState;
    history.pushState = function(state, title, url) {
      if (url && (String(url).indexOf('/watch') !== -1 || String(url).indexOf('/shorts/') !== -1)) {
        window.location.href = url;
        return;
      }
      return origPush.apply(this, arguments);
    };
  })();
</script>
`;

function proxyYoutubeDocument(req, res, hostname) {
  ignoreStreamErrors(req, res);

  dns.resolveReal(hostname)
    .then((ip) => {
      const headers = { ...req.headers, host: hostname };
      delete headers["accept-encoding"]; // Request uncompressed HTML to inject style & script cleanly

      const upstream = https.request(
        {
          host: ip,
          servername: hostname,
          port: 443,
          method: req.method,
          path: req.url,
          headers,
          rejectUnauthorized: false,
        },
        (upstreamRes) => {
          ignoreStreamErrors(upstreamRes);
          if (res.headersSent || res.writableEnded) return;

          const contentType = (upstreamRes.headers["content-type"] || "").toLowerCase();
          if (!contentType.includes("text/html")) {
            res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
            upstreamRes.pipe(res);
            return;
          }

          const outHeaders = { ...upstreamRes.headers };
          delete outHeaders["content-security-policy"];
          delete outHeaders["content-security-policy-report-only"];
          delete outHeaders["content-length"];

          res.writeHead(upstreamRes.statusCode || 200, outHeaders);

          let injected = false;
          upstreamRes.on("data", (chunk) => {
            if (!injected) {
              const str = chunk.toString("utf8");
              const headMatch = str.match(/<head[^>]*>/i);
              if (headMatch) {
                const headTag = headMatch[0];
                const modified = str.replace(headTag, headTag + YOUTUBE_INJECTION);
                injected = true;
                res.write(Buffer.from(modified, "utf8"));
                return;
              }
            }
            res.write(chunk);
          });
          upstreamRes.on("end", () => {
            res.end();
          });
        }
      );
      upstream.on("error", () => failResponse(res, 502, "Upstream error"));
      req.pipe(upstream);
    })
    .catch(() => failResponse(res, 502, "DNS resolution failed"));
}

function proxyPassthrough(req, res, hostname) {
  ignoreStreamErrors(req, res);

  dns.resolveReal(hostname)
    .then((ip) => {
      const upstream = https.request(
        {
          host: ip,
          servername: hostname,
          port: 443,
          method: req.method,
          path: req.url,
          headers: { ...req.headers, host: hostname },
          rejectUnauthorized: false,
        },
        (upstreamRes) => {
          ignoreStreamErrors(upstreamRes);
          if (res.headersSent || res.writableEnded) return;
          res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        }
      );
      upstream.on("error", () => failResponse(res, 502, "Upstream error"));
      req.pipe(upstream);
    })
    .catch(() => failResponse(res, 502, "DNS resolution failed"));
}

// Only top-level page loads should ever receive an HTML block page. Returning HTML
// for a script/image/fetch sub-resource silently breaks the page instead of blocking
// it - which would break playback of a whitelisted video whose assets live on
// youtube.com paths.
function isDocumentRequest(req) {
  const dest = req.headers["sec-fetch-dest"];
  if (dest) return dest === "document";
  return (req.headers.accept || "").includes("text/html");
}

async function handleYoutubeSite(req, res, hostname) {
  const url = new URL(req.url, `https://${hostname}`);
  const videoId = extractVideoId(url.pathname, url.searchParams);

  if (videoId) {
    const allowed = await isAllowed(url.pathname, url.searchParams, currentYoutubeRules);
    if (!allowed) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        blockPageHtml("Not on the whitelist", "Only approved videos, channels, and playlists can play.", {
          detail: `youtube.com/watch?v=${videoId}`,
          domain: "youtube.com",
          icon: "play",
          customHtml: currentCustomBlockHtml,
        })
      );
      return;
    }
    // Explicitly approved content is exempt from any youtube.com time budget.
    if (isDocumentRequest(req)) {
      proxyYoutubeDocument(req, res, hostname);
    } else {
      proxyPassthrough(req, res, hostname);
    }
    return;
  }

  // If this is a whitelisted playlist page (/playlist?list=PL...), allow it through even if over budget
  if (url.pathname === "/playlist") {
    const listId = url.searchParams.get("list");
    const isApprovedPlaylist = listId && currentYoutubeRules.some((r) => r.type === "PLAYLIST" && r.value === listId);
    if (isApprovedPlaylist) {
      if (isDocumentRequest(req)) {
        proxyYoutubeDocument(req, res, hostname);
      } else {
        proxyPassthrough(req, res, hostname);
      }
      return;
    }
  }

  // Everything that isn't approved playback (home, search, channel browsing) still
  // respects the daily time budget.
  if (isBlockedSocialHost(hostname) && isDocumentRequest(req)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      blockPageHtml("Time's up for today", "You can still open videos that have been approved.", {
        detail: hostname,
        domain: hostname,
        showResetCountdown: true,
        customHtml: currentCustomBlockHtml,
      })
    );
    return;
  }

  if (isDocumentRequest(req)) {
    proxyYoutubeDocument(req, res, hostname);
  } else {
    proxyPassthrough(req, res, hostname);
  }
}

async function handleYoutubeApi(req, res, hostname) {
  ignoreStreamErrors(req, res);
  const url = new URL(req.url, `https://${hostname}`);
  const isGatedApiCall = url.pathname.includes("/youtubei/v1/player") || url.pathname.includes("/youtubei/v1/next");

  if (!isGatedApiCall) {
    proxyPassthrough(req, res, hostname);
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let videoId = null;
    let playlistId = url.searchParams.get("list") || url.searchParams.get("playlistId") || null;
    try {
      const parsed = JSON.parse(body);
      videoId = parsed.videoId || null;
      if (parsed.playlistId) playlistId = parsed.playlistId;
    } catch {
      // non-JSON body, fall through and allow
    }

    if (videoId) {
      const searchParams = new URLSearchParams({ v: videoId });
      if (playlistId) searchParams.set("list", playlistId);
      const allowed = await isAllowed("/watch", searchParams, currentYoutubeRules);
      if (!allowed) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_whitelisted" }));
        return;
      }
    }

    dns.resolveReal(hostname)
      .then((ip) => {
        const upstream = https.request(
          {
            host: ip,
            servername: hostname,
            port: 443,
            method: req.method,
            path: req.url,
            headers: { ...req.headers, host: hostname, "content-length": Buffer.byteLength(body) },
            rejectUnauthorized: false,
          },
          (upstreamRes) => {
            ignoreStreamErrors(upstreamRes);
            if (res.headersSent || res.writableEnded) return;
            res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
            upstreamRes.pipe(res);
          }
        );
        upstream.on("error", () => failResponse(res, 502, "Upstream error"));
        upstream.end(body);
      })
      .catch(() => failResponse(res, 502, "DNS resolution failed"));
  });
}

function requestHandler(req, res) {
  const hostname = (req.headers.host || "").split(":")[0];

  // Route /youtubei/v1/player and /youtubei/v1/next on either www.youtube.com or youtubei.googleapis.com
  const isYoutubeApi = req.url.includes("/youtubei/v1/player") || req.url.includes("/youtubei/v1/next");
  if (isYoutubeApi && (YOUTUBE_HOSTS.has(hostname) || YOUTUBE_API_HOSTS.has(hostname))) {
    handleYoutubeApi(req, res, hostname);
    return;
  }


  // YouTube is handled by the whitelist first, so approved videos stay playable even
  // once a youtube.com time budget is exhausted. handleYoutubeSite applies the budget
  // itself to everything that isn't approved playback.
  if (YOUTUBE_HOSTS.has(hostname)) {
    handleYoutubeSite(req, res, hostname);
    return;
  }
  if (YOUTUBE_API_HOSTS.has(hostname)) {
    handleYoutubeApi(req, res, hostname);
    return;
  }

  if (isBlockedSocialHost(hostname)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      blockPageHtml("Time's up for today", "You've used your daily time for this site.", {
        detail: hostname,
        domain: hostname,
        showResetCountdown: true,
        customHtml: currentCustomBlockHtml,
      })
    );
    return;
  }

  res.writeHead(404);
  res.end("Not intercepted");
}

function listenOrFail(server, port, label) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener("listening", onListening);
      reject(new Error(`${label} could not bind to 127.0.0.1:${port} - ${err.message}`));
    };
    const onListening = () => {
      server.removeListener("error", onError);
      log(`${label} listening on 127.0.0.1:${port}`);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

// Resolves only once both listeners are actually bound. The caller must not write any
// hosts-file redirects before this resolves - pointing a domain at a dead 127.0.0.1
// makes the site fail with ERR_CONNECTION_REFUSED instead of showing the block page.
async function start() {
  const ca = ensureCA();

  const httpsServer = https.createServer(
    {
      SNICallback: (servername, cb) => {
        const leaf = getLeafCert(servername, ca);
        cb(null, tls.createSecureContext({ key: leaf.key, cert: leaf.cert }));
      },
      key: getLeafCert("localhost", ca).key,
      cert: getLeafCert("localhost", ca).cert,
    },
    requestHandler
  );

  const httpServer = http.createServer((req, res) => {
    const hostname = (req.headers.host || "").split(":")[0];
    res.writeHead(301, { Location: `https://${hostname}${req.url}` });
    res.end();
  });

  await listenOrFail(httpsServer, 443, "HTTPS intercept");
  try {
    await listenOrFail(httpServer, 80, "HTTP redirect");
  } catch (err) {
    // Port 80 is only for HTTP->HTTPS redirects. If it is already in use by Windows (IIS, http.sys, etc.),
    // continue running HTTPS intercept on 443 so we don't abort the entire agent.
    log("Warning: HTTP redirect listener on port 80 could not start:", err.message);
  }

  // Runtime errors after a successful bind shouldn't take the process down.
  httpsServer.on("error", (err) => log("HTTPS intercept server error:", err.message));
  httpServer.on("error", (err) => log("HTTP intercept server error:", err.message));

  return { httpsServer, httpServer };
}

// requestHandler is exported for the routing tests in test/routing.test.js.
module.exports = { start, setYoutubeRules, setBlockedDomains, setCustomBlockHtml, requestHandler };

