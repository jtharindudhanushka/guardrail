const https = require("https");
const http = require("http");
const { URL } = require("url");

function request(method, urlStr, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const req = lib.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = null;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(parsed);
          }
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function pair(portalUrl, code) {
  return request("POST", `${portalUrl}/api/agent/pair`, { body: { code } });
}

async function fetchRules(portalUrl, apiKey) {
  return request("GET", `${portalUrl}/api/agent/rules`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

async function reportUsage(portalUrl, apiKey, usage) {
  return request("POST", `${portalUrl}/api/agent/usage`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: { usage },
  });
}

module.exports = { pair, fetchRules, reportUsage };
