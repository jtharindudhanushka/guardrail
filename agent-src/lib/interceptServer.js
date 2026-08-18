const https = require("https");
const http = require("http");
const tls = require("tls");
const { URL } = require("url");
const { ensureCA, getLeafCert } = require("./certs");
const { resolveReal } = require("./resolve");
const { isAllowed, extractVideoId } = require("./youtubeRules");
const { blockPageHtml } = require("./blockPage");
const { log } = require("./log");

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const YOUTUBE_API_HOSTS = new Set(["youtubei.googleapis.com"]);

let currentYoutubeRules = [];
let currentBlockedDomains = new Set();

function setYoutubeRules(rules) {
  currentYoutubeRules = rules;
}
function setBlockedDomains(domains) {
  currentBlockedDomains = new Set(domains);
}

function isBlockedSocialHost(hostname) {
  const bare = hostname.replace(/^www\./, "");
  return currentBlockedDomains.has(bare) || currentBlockedDomains.has(hostname);
}

function proxyPassthrough(req, res, hostname) {
  resolveReal(hostname)
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
          res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        }
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end("Upstream error");
      });
      req.pipe(upstream);
    })
    .catch(() => {
      res.writeHead(502);
      res.end("DNS resolution failed");
    });
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
          icon: "play",
        })
      );
      return;
    }
    // Explicitly approved content is exempt from any youtube.com time budget.
    proxyPassthrough(req, res, hostname);
    return;
  }

  // Everything that isn't approved playback (home, search, channel browsing) still
  // respects the daily time budget.
  if (isBlockedSocialHost(hostname) && isDocumentRequest(req)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      blockPageHtml("Time's up for today", "You can still open videos that have been approved.", {
        detail: hostname,
        showResetCountdown: true,
      })
    );
    return;
  }

  proxyPassthrough(req, res, hostname);
}

async function handleYoutubeApi(req, res, hostname) {
  const url = new URL(req.url, `https://${hostname}`);
  const isPlayerCall = url.pathname.includes("/youtubei/v1/player");

  if (!isPlayerCall) {
    proxyPassthrough(req, res, hostname);
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let videoId = null;
    try {
      videoId = JSON.parse(body).videoId || null;
    } catch {
      // non-JSON body, fall through and allow
    }

    if (videoId) {
      const allowed = await isAllowed("/watch", new URLSearchParams({ v: videoId }), currentYoutubeRules);
      if (!allowed) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_whitelisted" }));
        return;
      }
    }

    resolveReal(hostname)
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
            res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
            upstreamRes.pipe(res);
          }
        );
        upstream.on("error", () => {
          res.writeHead(502);
          res.end("Upstream error");
        });
        upstream.end(body);
      })
      .catch(() => {
        res.writeHead(502);
        res.end("DNS resolution failed");
      });
  });
}

function requestHandler(req, res) {
  const hostname = (req.headers.host || "").split(":")[0];

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
        showResetCountdown: true,
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
  await listenOrFail(httpServer, 80, "HTTP redirect");

  // Runtime errors after a successful bind shouldn't take the process down.
  httpsServer.on("error", (err) => log("HTTPS intercept server error:", err.message));
  httpServer.on("error", (err) => log("HTTP intercept server error:", err.message));

  return { httpsServer, httpServer };
}

// requestHandler is exported for the routing tests in test/routing.test.js.
module.exports = { start, setYoutubeRules, setBlockedDomains, requestHandler };
