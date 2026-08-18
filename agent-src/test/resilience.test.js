// Regression tests for failures that previously killed the whole agent process.
// Run with: node test/resilience.test.js
const assert = require("assert");
const path = require("path");
const { EventEmitter } = require("events");

process.env.GUARDRAIL_DATA_DIR = path.join(__dirname, ".tmp-testdata");

const dns = require("../lib/resolve");
const interceptServer = require("../lib/interceptServer");

// Minimal stand-in for a ServerResponse that tracks whether headers went out, and
// throws from writeHead once they have - exactly like Node's real implementation.
function makeRes() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.writableEnded = false;
  res.destroyed = false;
  res.writeHead = () => {
    if (res.headersSent) {
      const e = new Error("Cannot write headers after they are sent to the client");
      e.code = "ERR_HTTP_HEADERS_SENT";
      throw e;
    }
    res.headersSent = true;
    return res;
  };
  res.end = () => { res.writableEnded = true; };
  res.destroy = () => { res.destroyed = true; };
  res.write = () => true;
  return res;
}

function makeReq(url) {
  const req = new EventEmitter();
  req.headers = { host: "www.youtube.com", accept: "text/html", "sec-fetch-dest": "document" };
  req.url = url;
  req.method = "GET";
  req.pipe = () => {};
  return req;
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log("PASS  " + name);
  } catch (e) {
    failures++;
    console.log("FAIL  " + name + " -> " + e.message);
  }
}

(async () => {
  interceptServer.setBlockedDomains([]);
  interceptServer.setYoutubeRules([{ type: "VIDEO", value: "OK1" }]);

  // The original crash: DNS fails, and the catch path calls writeHead on a response
  // whose headers were already sent. Must not throw.
  dns.resolveReal = () => Promise.reject(new Error("ENOTFOUND"));
  {
    const req = makeReq("/watch?v=OK1");
    const res = makeRes();
    res.headersSent = true; // simulate a response already mid-stream
    interceptServer.requestHandler(req, res);
    await new Promise((r) => setTimeout(r, 20));
    check("DNS failure after headers sent does not throw", () => {
      assert.strictEqual(res.destroyed, true, "expected the response to be destroyed");
    });
  }

  // Same path, but headers not yet sent: should produce a clean 502 instead.
  {
    const req = makeReq("/watch?v=OK1");
    const res = makeRes();
    interceptServer.requestHandler(req, res);
    await new Promise((r) => setTimeout(r, 20));
    check("DNS failure before headers sent returns a response", () => {
      assert.strictEqual(res.headersSent, true, "expected headers to be written");
      assert.strictEqual(res.writableEnded, true, "expected the response to be ended");
    });
  }

  // A client that disconnects mid-request emits an error on the request stream.
  // Nothing should escape to uncaughtException.
  {
    const req = makeReq("/watch?v=OK1");
    const res = makeRes();
    interceptServer.requestHandler(req, res);
    await new Promise((r) => setTimeout(r, 10));
    check("client abort does not throw", () => {
      req.emit("error", new Error("ECONNRESET"));
      res.emit("error", new Error("ECONNRESET"));
    });
  }

  console.log(failures ? `\n${failures} test(s) failed.` : "\nAll resilience tests passed.");
  process.exit(failures ? 1 : 0);
})();
