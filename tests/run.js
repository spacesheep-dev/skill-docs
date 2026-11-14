// The repo's tests: node tests/run.js. No dependencies.
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`ok   ${name}`); }
  catch (e) { fail++; console.log(`FAIL ${name}\n     ${String(e && e.stack || e).split("\n").slice(0, 3).join("\n     ")}`); }
}
for (const f of ["ownership", "commands"]) {
  try { require(path.join(__dirname, f + ".js"))({ test, ROOT }); }
  catch (e) { fail++; console.log(`FAIL ${f}.js didn't load: ${String(e.message).split("\n")[0]}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
