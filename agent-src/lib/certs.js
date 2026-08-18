const fs = require("fs");
const forge = require("node-forge");
const { CA_KEY_PATH, CA_CERT_PATH } = require("./paths");

const pki = forge.pki;

function randomSerial() {
  return String(Date.now()) + String(Math.floor(Math.random() * 1e6));
}

function buildCA() {
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);

  const attrs = [{ name: "commonName", value: "Guardrail Local CA" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true, cRLSign: true, critical: true },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    key: pki.privateKeyToPem(keys.privateKey),
    cert: pki.certificateToPem(cert),
  };
}

function ensureCA() {
  if (fs.existsSync(CA_KEY_PATH) && fs.existsSync(CA_CERT_PATH)) {
    return { key: fs.readFileSync(CA_KEY_PATH, "utf8"), cert: fs.readFileSync(CA_CERT_PATH, "utf8") };
  }
  const ca = buildCA();
  fs.writeFileSync(CA_KEY_PATH, ca.key);
  fs.writeFileSync(CA_CERT_PATH, ca.cert);
  return ca;
}

const leafCache = new Map();

// Generates (and caches) a leaf certificate for `hostname`, signed by our local CA private key
// so any browser that trusts the installed CA root will also trust this leaf.
function getLeafCert(hostname, ca) {
  if (leafCache.has(hostname)) return leafCache.get(hostname);

  const caCert = pki.certificateFromPem(ca.cert);
  const caKey = pki.privateKeyFromPem(ca.key);

  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 800 * 24 * 60 * 60 * 1000);

  cert.setSubject([{ name: "commonName", value: hostname }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: hostname }] },
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  const leaf = {
    key: pki.privateKeyToPem(keys.privateKey),
    cert: pki.certificateToPem(cert),
  };
  leafCache.set(hostname, leaf);
  return leaf;
}

module.exports = { ensureCA, getLeafCert };
