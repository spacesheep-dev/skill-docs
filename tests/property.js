// The spine, at random: a person types into blocks, adds blocks (with an id and without) and splits them,
// between random commands. After every command each of the person's words is still there, as many times, in
// the same order and the same section, and no live edit touched one of their blocks. Loaded by tests/run.js.
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { fakeSpace } = require("./fake");

module.exports = function ({ test, ROOT }) {
  const D = require(path.join(ROOT, "docs/assets/docs.js"));
  const go = (s, dir, args, stdin) => D.run({ io: s.io, dir, log: () => {}, stdin: () => stdin }, args);

  function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

  function trial(seed, steps) {
    const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)];
    const s = fakeSpace(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-prop-"));
    const N = 1 + Math.floor(r() * 4);
    go(s, dir, ["start", s.id]);
    go(s, dir, ["outline", "T", ...Array.from({ length: N }, (_, i) => `H${i + 1}`)]);
    let k = 0, j = 0;
    const marks = []; // the person's words: each a unique marker, and how many times it appears
    const sectionAt = (h, at) => { let best = null; for (const m of h.matchAll(/<section data-ss-id="(d-s\d+)"/g)) if (m.index < at) best = m[1]; return best; };
    const snapshot = () => { const h = s.files["index.html"].split("</head>")[1]; return marks.map((m) => ({ m: m.m, n: h.split(m.m).length - 1, at: h.indexOf(m.m), sec: sectionAt(h, h.indexOf(m.m)) })); };
    const personIds = () => { const h = s.files["index.html"], ids = new Set(); for (const m of marks) { const at = h.indexOf(m.m); const open = h.lastIndexOf("<", h.lastIndexOf('data-ss-id="', at) >= 0 ? at : 0); const mm = /data-ss-id="([^"]+)"/.exec(h.slice(h.lastIndexOf("<p", at), at)); if (mm) ids.add(mm[1]); } return ids; };
    for (let step = 0; step < steps; step++) {
      if (r() < 0.4) {
        // The person.
        const h = s.files["index.html"], blocks = [...h.matchAll(/<(p|ul|h3|blockquote)( data-ss-id="([^"]+)")?[^>]*>([\s\S]*?)<\/\1>/g)].filter((m) => !/^d-(title|s\d+-h)$/.test(m[3] || ""));
        if (!blocks.length) continue;
        const b = pick(blocks), kind = pick(["type", "add", "loose", "split"]), mk = `P${k++}x`;
        if (kind === "type") { s.person((x) => x.slice(0, b.index) + b[0].replace(b[4], `${mk} typed`) + x.slice(b.index + b[0].length)); marks.splice(0, marks.length, ...marks.filter((m) => !b[4].includes(m.m))); marks.push({ m: mk }); }
        else if (kind === "split") { s.person((x) => x.slice(0, b.index) + b[0].replace(b[4], `${mk} one`) + "\n" + b[0].replace(b[4], `${mk} two`) + x.slice(b.index + b[0].length)); marks.splice(0, marks.length, ...marks.filter((m) => !b[4].includes(m.m))); marks.push({ m: `${mk} one` }, { m: `${mk} two` }); }
        else { const add = kind === "add" ? `<p data-ss-id="p-${mk}">${mk} added</p>` : `<p>${mk} loose</p>`; s.person((x) => x.slice(0, b.index + b[0].length) + "\n" + add + x.slice(b.index + b[0].length)); marks.push({ m: mk }); }
        continue;
      }
      // A command.
      const before = snapshot(), ids = personIds(), pushed = s.pushes.length;
      const n = Math.floor(r() * (N + 1));
      const L = D.ledgerOf(s.files["index.html"]), own = Object.keys(L.blocks).filter((id) => !/^d-(title|s\d+-h)$/.test(id));
      const anyId = pick([...own, ...[...ids]].concat(["d-s0-1"]));
      const text = Array.from({ length: Math.floor(r() * 4) }, () => `T${j++}t words`).join("\n\n");
      const cmd = pick(["write", "write", "write", "edit", "propose", "blocks", "done", "comments"]);
      if (cmd === "write") go(s, dir, ["write", String(n), "-"], text);
      else if (cmd === "edit") go(s, dir, ["edit", anyId, "-"], text);
      else if (cmd === "propose") go(s, dir, ["propose", anyId, "-"], text || "x");
      else go(s, dir, [cmd]);
      const after = snapshot();
      after.forEach((a, i) => {
        const b = before[i], why = `seed ${seed} step ${step} ${cmd}: ${a.m}`;
        assert.strictEqual(a.n, b.n, `${why}: count`);
        assert.strictEqual(a.sec, b.sec, `${why}: section`);
      });
      const order = (x) => x.map((a) => a.at).map((v, i, arr) => arr.filter((w) => w < v).length);
      assert.deepStrictEqual(order(after), order(before), `seed ${seed} step ${step} ${cmd}: order`);
      for (const p of s.pushes.slice(pushed)) for (const e of p.edits || []) if (e.op !== "append_into") assert.ok(!ids.has(e.anchor), `seed ${seed} step ${step} ${cmd}: live ${e.op} on the person's ${e.anchor}`);
    }
    return marks.length;
  }

  test("at random: 200 documents, 30 steps each, the person's words always survive in place", () => {
    let marks = 0;
    for (let seed = 1; seed <= 200; seed++) marks += trial(seed, 30);
    assert.ok(marks > 500, `the person did enough (${marks} marks)`);
  });
};
