const dns = require("dns");

const resolver = new dns.Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;

// Resolves the real IP for `hostname`, bypassing the local hosts file (which we've
// redirected to 127.0.0.1) by querying a public resolver directly.
function resolveReal(hostname) {
  const cached = cache.get(hostname);
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.ip);

  return new Promise((resolve, reject) => {
    resolver.resolve4(hostname, (err, addresses) => {
      if (err || !addresses || !addresses.length) return reject(err || new Error("No A record"));
      cache.set(hostname, { ip: addresses[0], at: Date.now() });
      resolve(addresses[0]);
    });
  });
}

module.exports = { resolveReal };
