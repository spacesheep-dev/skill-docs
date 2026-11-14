// Comments become edits (each lands on its own block, nothing else moves), and changes to the person's words
// wait for their yes in a pinned comment. Loaded by tests/run.js.
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { fakeSpace } = require("./fake");

module.exports = function ({ test, ROOT }) {
  const D = require(path.join(ROOT, "docs/assets/docs.js"));
  const go = (s, dir, args, stdin) => { const lines = []; const code = D.run({ io: s.io, dir, log: (l) => lines.push(String(l)), stdin: () => stdin }, args); return { code, out: lines.join("\n") }; };
  // A document of 5 sections, 2 paragraphs each: 10 blocks of the tool's.
  const doc = () => {
    const s = fakeSpace(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-test-"));
    go(s, dir, ["start", s.id]);
    go(s, dir, ["outline", "Plan", "A", "B", "C", "D", "E"]);
    for (let n = 1; n <= 5; n++) assert.strictEqual(go(s, dir, ["write", String(n), "-"], `Section ${n}, first.\n\nSection ${n}, second.`).code, 0);
    return { s, dir };
  };
  const blocksOf = (html) => { const out = {}; for (const m of html.matchAll(/<(p|ul|ol|h[1-3]|blockquote) data-ss-id="([^"]+)"[^>]*>[\s\S]*?<\/\1>/g)) out[m[2]] = m[0]; return out; };

  test("10 comments, each on its own block: only that block changes, and each thread is answered and resolved", () => {
    const { s, dir } = doc();
    const before = blocksOf(s.files["index.html"]);
    const ids = []; for (let n = 1; n <= 5; n++) ids.push(`d-s${n}-1`, `d-s${n}-2`);
    const asked = ids.map((id, i) => s.say({ block: id, body: `Change ${i}` }));
    const list = go(s, dir, ["comments"]).out;
    for (const c of asked) assert.ok(list.includes(c.id.slice(0, 8)), "listed");
    asked.forEach((c, i) => {
      assert.strictEqual(go(s, dir, ["edit", ids[i], "-"], `Changed ${i}, as asked.`).code, 0);
      assert.strictEqual(go(s, dir, ["reply", c.id.slice(0, 8), `Done: changed ${i}.`, "--resolve"]).code, 0);
      const now = blocksOf(s.files["index.html"]);
      for (const [id, h] of Object.entries(before)) {
        if (ids.slice(0, i + 1).includes(id)) assert.ok(now[id].includes(`Changed ${ids.indexOf(id)}, as asked.`), `${id} took its edit`);
        else assert.strictEqual(now[id], h, `${id} unchanged by comment ${i}`);
      }
    });
    assert.match(go(s, dir, ["comments"]).out, /no open comments/);
    assert.ok(s.comments.filter((c) => c.reply_to).every((c) => c.body.startsWith("Agent: ")), "the tool's replies say they are the agent's");
  });

  test("5 changes to the person's words, each settled by their reply: yes applies it, and it stays theirs", () => {
    const { s, dir } = doc();
    const theirs = [];
    s.person((h) => h.replace(/(<p data-ss-id="d-s(\d)-1">)[^<]*(<\/p>)/g, (m, a, n, b) => { theirs.push(`d-s${n}-1`); return `${a}The person's own line ${n}.${b}`; }));
    assert.strictEqual(theirs.length, 5);
    const props = theirs.map((id, i) => {
      const r = go(s, dir, ["propose", id, "-"], `A tighter line ${i}.`);
      assert.strictEqual(r.code, 0, r.out);
      assert.ok(s.files["index.html"].includes(`The person's own line ${i + 1}.`), "nothing changes on a proposal");
      return s.comments[s.comments.length - 1];
    });
    for (const p of props) { assert.strictEqual(p.block, theirs[props.indexOf(p)]); assert.match(p.quote, /The person's own line/); assert.match(p.body, /^Agent: /); }
    props.forEach((p, i) => {
      assert.notStrictEqual(go(s, dir, ["apply", p.id.slice(0, 8)]).code, 0, "no answer yet: refused");
      s.say({ reply_to: p.id, body: "yes" });
      const r = go(s, dir, ["apply", p.id.slice(0, 8)]);
      assert.strictEqual(r.code, 0, r.out);
      assert.ok(s.files["index.html"].includes(`A tighter line ${i}.`));
      assert.ok(s.comments.find((c) => c.id === p.id).resolved, "resolved");
    });
    // Applied with their yes, the words are still the person's: the tool can't change them again unasked.
    assert.notStrictEqual(go(s, dir, ["edit", theirs[0], "-"], "Again.").code, 0);
    assert.deepStrictEqual(D.ledgerOf(s.files["index.html"]).proposals, {});
  });

  test("a block the person changed after the proposal is asked again, not overwritten", () => {
    const { s, dir } = doc();
    s.person((h) => h.replace(/(<p data-ss-id="d-s2-1">)[^<]*/, "$1Mine."));
    go(s, dir, ["propose", "d-s2-1", "-"], "Better.");
    const p = s.comments[s.comments.length - 1];
    s.person((h) => h.replace("Mine.", "Mine, changed again."));
    s.say({ reply_to: p.id, body: "yes" });
    const r = go(s, dir, ["apply", p.id.slice(0, 8)]);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /changed since you proposed/);
    assert.ok(s.files["index.html"].includes("Mine, changed again."));
    assert.ok(!s.files["index.html"].split("</head>")[1].includes("Better."), "the proposal isn't in the body");
    assert.strictEqual(go(s, dir, ["propose", "d-s2-1", "-"], "Better still.").code, 0, "asked again");
  });

  test("propose is refused on the tool's own block, and edit on the person's", () => {
    const { s, dir } = doc();
    assert.match(go(s, dir, ["propose", "d-s1-1", "-"], "x").out, /is yours/);
    s.person((h) => h.replace(/(<p data-ss-id="d-s1-2">)[^<]*/, "$1Theirs."));
    assert.match(go(s, dir, ["edit", "d-s1-2", "-"], "x").out, /is the person's: propose/);
  });

  test("propose takes changes [{block, before, after}] and a reason, and refuses as a conflict when before isn't what the block reads", () => {
    const { s } = doc();
    const html = s.files["index.html"], n = s.comments.length;
    assert.throws(() => D.propose({ io: s.io }, html, { changes: [{ block: "d-s1-1", before: "Not what it says.", after: "x" }], reason: "r" }), (e) => e.code === "conflict");
    assert.strictEqual(s.comments.length, n, "nothing posted on a conflict");
    const ids = D.propose({ io: s.io }, html, { changes: [{ block: "d-s1-1", before: "Section 1, first.", after: "Tighter." }], reason: "Shorter, as asked." });
    assert.strictEqual(ids.length, 1);
    const c = s.comments[s.comments.length - 1];
    assert.deepStrictEqual([c.block, c.quote], ["d-s1-1", "Section 1, first."]);
    assert.match(c.body, /> Tighter\.[\s\S]*Shorter, as asked\./);
  });
};
