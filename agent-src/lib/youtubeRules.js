const https = require("https");
const { resolveReal } = require("./resolve");

const channelCache = new Map(); // videoId -> { channelUrl, at }
const CHANNEL_CACHE_MS = 60 * 60 * 1000;

function extractVideoId(pathname, query) {
  if (pathname === "/watch" && query.get("v")) return query.get("v");
  const shorts = pathname.match(/^\/shorts\/([^/?]+)/);
  if (shorts) return shorts[1];
  const embed = pathname.match(/^\/embed\/([^/?]+)/);
  if (embed) return embed[1];
  return null;
}

// Free, keyless oEmbed lookup to resolve which channel a video belongs to.
function lookupChannelForVideo(videoId) {
  const cached = channelCache.get(videoId);
  if (cached && Date.now() - cached.at < CHANNEL_CACHE_MS) return Promise.resolve(cached.channelUrl);

  return new Promise(async (resolve) => {
    try {
      const ip = await resolveReal("www.youtube.com");
      const options = {
        host: ip,
        servername: "www.youtube.com",
        path: `/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
        headers: { Host: "www.youtube.com" },
        timeout: 5000,
      };
      const req = https.get(options, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            const channelUrl = json.author_url || null;
            channelCache.set(videoId, { channelUrl, at: Date.now() });
            resolve(channelUrl);
          } catch {
            resolve(null);
          }
        });
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

// rules: [{ type: 'VIDEO'|'CHANNEL'|'PLAYLIST', value }]
async function isAllowed(pathname, searchParams, rules) {
  if (!rules.length) return false;

  // Non-video pages (home, search results list, channel browsing) are left open so
  // whitelist checks only gate actual playback - browsing to find things isn't blocked.
  const videoId = extractVideoId(pathname, searchParams);
  if (!videoId) return true;

  for (const rule of rules) {
    if (rule.type === "VIDEO" && rule.value === videoId) return true;
    if (rule.type === "PLAYLIST" && searchParams.get("list") === rule.value) return true;
  }

  const channelRules = rules.filter((r) => r.type === "CHANNEL");
  if (channelRules.length) {
    const channelUrl = await lookupChannelForVideo(videoId);
    if (channelUrl) {
      for (const rule of channelRules) {
        const needle = rule.value.replace(/^@/, "").toLowerCase();
        if (channelUrl.toLowerCase().includes(needle)) return true;
      }
    }
  }

  return false;
}

module.exports = { isAllowed, extractVideoId };
