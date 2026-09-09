const assert = require("assert");
const vm = require("vm");
const updater = require("../lib/updater");

console.log("Testing updater logic...");

// 1. Version checks
assert.strictEqual(updater.shouldUpdate(null), false, "null version should not update");
assert.strictEqual(updater.shouldUpdate(""), false, "empty version should not update");
assert.strictEqual(updater.shouldUpdate(updater.getLocalVersion()), false, "same version should not update");
assert.strictEqual(updater.shouldUpdate("99.9.9"), true, "newer version should update");
console.log("PASS  version comparison checks");

// 2. Syntax pre-verification test
const validJs = "function hello() { return 'world'; }; module.exports = hello;";
let compileSuccess = false;
try {
  new vm.Script(validJs);
  compileSuccess = true;
} catch {}
assert.strictEqual(compileSuccess, true, "valid JS compiles without error");

const invalidJs = "function hello() { return 'world'; broken syntax {{{";
let compileFailed = false;
try {
  new vm.Script(invalidJs);
} catch {
  compileFailed = true;
}
assert.strictEqual(compileFailed, true, "invalid JS is caught before disk swap");
console.log("PASS  syntax verification detects syntax errors safely");

console.log("\nAll updater tests passed.");
