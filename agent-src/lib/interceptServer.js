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

async function handleYoutubeSite(req, res, hostname) {
  const url = new URL(req.url, `https://${hostname}`);
  const videoId = extractVideoId(url.pathname, url.searchParams);

  if (videoId) {
    const allowed = await isAllowed(url.pathname, url.searchParams, currentYoutubeRules);
    if (!allowed) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(blockPageHtml("This video isn't on the whitelist", "Ask for it to be added, or request a bypass."));
      return;
    }
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

  if (isBlockedSocialHost(hostname)) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(blockPageHtml("Time's up for today", "This site is over its daily limit. Ask for a bypass if you need more time."));
    return;
  }
  if (YOUTUBE_HOSTS.has(hostname)) {
    handleYoutubeSite(req, res, hostname);
    return;
  }
  if (YOUTUBE_API_HOSTS.has(hostname)) {
    handleYoutubeApi(req, res, hostname);
    return;
  }

  res.writeHead(404);
  res.end("Not intercepted");
}

function start() {
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

  httpsServer.on("error", (err) => log("HTTPS intercept server error:", err.message));
  httpsServer.listen(443, "127.0.0.1", () => log("YouTube/social intercept listening on 127.0.0.1:443"));

  const httpServer = http.createServer((req, res) => {
    const hostname = (req.headers.host || "").split(":")[0];
    res.writeHead(301, { Location: `https://${hostname}${req.url}` });
    res.end();
  });
  httpServer.on("error", (err) => log("HTTP intercept server error:", err.message));
  httpServer.listen(80, "127.0.0.1", () => log("HTTP redirect listening on 127.0.0.1:80"));

  return { caCertPath: ca.cert };
}

module.exports = { start, setYoutubeRules, setBlockedDomains };
