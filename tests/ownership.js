// The release's spine: the tool changes only blocks it made and that still read as it last wrote them.
// A block a person typed in, a block a person added (with an id or without), and an id that appears
// twice are the person's: no command changes, moves or removes them, live or saved.
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { fakeSpace } = require("./fake");

module.exports = function ({ test, ROOT }) {
  const D = require(path.join(ROOT, "docs/assets/docs.js"));
  const run = (s, args, opts = {}) => {
    const lines = [];
    const code = D.run({ io: s.io, dir: opts.dir || fs.mkdtempSync(path.join(os.tmpdir(), "docs-test-")), log: (l) => lines.push(String(l)) }, args);
    return { code, out: lines.join("\n") };
  };
  const page = (s) => s.files["index.html"];
  const count = (hay, needle) => hay.split(needle).length - 1;
  // Which tool section each person block sits in, by the page's own <section data-ss-id="d-sN"> spans.
  const sectionOf = (html, needle) => {
    const at = html.indexOf(needle);
    let best = null;
    for (const m of html.matchAll(/<section data-ss-id="(d-s\d+)"[^>]*>/g)) { if (m.index < at) best = m[1]; }
    const close = html.lastIndexOf("</section>", at), open = best ? html.indexOf(`data-ss-id="${best}"`) : -1;
    return close > open ? null : best;
  };
  // The commands every test below must cover: a new command fails this until it is in the walk.
  const WALKED = ["start", "write", "blocks", "done"];

  test("every command the tool has is in the person's-block walk", () => {
    assert.deepStrictEqual(Object.keys(D.COMMANDS).sort(), WALKED.slice().sort());
  });

  test("a person's block survives every command, live and saved", () => {
    const s = fakeSpace(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-test-"));
    assert.strictEqual(run(s, ["start", s.id, "Sublet proposal", "What I'm asking", "Why", "The subtenant", "Next steps"], { dir }).code, 0);
    // The person, while the outline is up: types into one placeholder, adds a block with an id of their
    // own, adds one with none, splits a placeholder in two (its id now twice), and adds a whole section.
    const typed = '<p data-ss-id="d-s1-1" class="todo">Our cat stays with a friend.</p>';
    const added = '<p data-ss-id="p-1">I want this said first.</p>';
    const loose = "<p>A line with no id.</p>";
    const split = '<p data-ss-id="d-s3-1" class="todo">Writing…</p>';
    const theirs = '<section><h2>My own part</h2><p>Mine.</p></section>';
    s.person((h) => {
      h = h.replace(/<p data-ss-id="d-s1-1"[^>]*>[\s\S]*?<\/p>/, typed);
      h = h.replace(/(<h2 data-ss-id="d-s2-h"[^>]*>[\s\S]*?<\/h2>)/, `$1\n${added}`);
      h = h.replace(/(<section data-ss-id="d-s3"[^>]*>[\s\S]*?)(<\/section>)/, `$1${loose}\n$2`);
      h = h.replace(/<p data-ss-id="d-s3-1"[^>]*>[\s\S]*?<\/p>/, `${split}\n${split}`);
      h = h.replace(/(<section data-ss-id="d-s4")/, `${theirs}\n$1`);
      return h;
    });
    const mine = [typed, added, loose, split, theirs];
    const where = mine.map((b) => sectionOf(page(s), b));
    const order = () => mine.map((b) => page(s).indexOf(b));
    const rank = (o) => o.map((x) => o.filter((y) => y < x).length);
    const rank0 = rank(order());
    const personIds = ["d-s1-1", "p-1", "d-s3-1"];
    const check = (what) => {
      const h = page(s);
      assert.strictEqual(count(h, typed), 1, `${what}: the typed block`);
      assert.strictEqual(count(h, added), 1, `${what}: the added block`);
      assert.strictEqual(count(h, loose), 1, `${what}: the block with no id`);
      assert.strictEqual(count(h, split), 2, `${what}: both halves of the split block`);
      assert.strictEqual(count(h, theirs), 1, `${what}: their own section`);
      assert.deepStrictEqual(rank(order()), rank0, `${what}: the person's blocks keep their order`);
      assert.deepStrictEqual(mine.map((b) => sectionOf(h, b)), where, `${what}: each stays in its section`);
      for (const p of s.pushes) for (const e of p.edits || []) {
        if (e.op === "append_into") assert.match(e.anchor, /^d-s\d+$/, `${what}: appends only into a section`);
        else assert.ok(!personIds.includes(e.anchor), `${what}: a live ${e.op} on the person's ${e.anchor}`);
      }
      if (s.pushes.some((p) => p.html)) assert.fail(`${what}: a whole page pushed over the person's blocks`);
    };
    s.pushes.length = 0;
    const steps = [
      ["write", "0", "-", "A short note asking for your consent to sublet."],
      ["write", "1", "-", "I am asking to sublet for six months.\n\nI would stay your tenant throughout."],
      ["write", "2", "-", "I will be working abroad.\n\nThe flat stays lived in.\n\nThe rent keeps arriving."],
      ["write", "3", "-", "- References\n- A written agreement"],
      ["write", "2", "-", "I will be working abroad."],
      ["blocks"],
      ["blocks", "2"],
      ["start", s.id],
      ["done"],
    ];
    for (const st of steps) {
      const [cmd, ...rest] = st;
      const stdin = cmd === "write" ? rest.pop() : null;
      const lines = [];
      D.run({ io: s.io, dir, log: (l) => lines.push(String(l)), stdin: () => stdin }, [cmd, ...rest]);
      check(st.slice(0, 2).join(" "));
    }
    // The tool's own words went in around them.
    assert.ok(page(s).includes("I am asking to sublet for six months."));
    assert.ok(page(s).includes("I will be working abroad."));
    assert.ok(!page(s).includes("The flat stays lived in."), "the tool removed its own paragraph");
  });

  test("a person's change that lands between the tool's read and its save is kept", () => {
    const s = fakeSpace(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-test-"));
    run(s, ["start", s.id, "Title", "One"], { dir });
    D.run({ io: s.io, dir, log: () => {}, stdin: () => "First words." }, ["write", "1", "-"]);
    const theirs = "Their words, typed while the tool wrote.";
    s.beforeSave = (sp) => { sp.files["index.html"] = sp.files["index.html"].replace("First words.", theirs); };
    const lines = [];
    D.run({ io: s.io, dir, log: (l) => lines.push(String(l)), stdin: () => "Second words." }, ["write", "1", "-"]);
    assert.ok(page(s).includes(theirs), "their words are in the saved page");
    assert.ok(!page(s).includes("Second words.</p>") || page(s).includes(theirs), "theirs kept beside the tool's");
    assert.match(lines.join("\n"), /person/i, "the tool says a person changed it");
  });

  test("a page that isn't a document from this skill is never written over", () => {
    const words = "<p>" + "A page someone wrote by hand, with plenty of words in it. ".repeat(8) + "</p>";
    const s = fakeSpace({ "index.html": `<!doctype html><html><head><title>x</title></head><body><h1>Mine</h1>${words}</body></html>` });
    const before = page(s);
    const r = run(s, ["start", s.id, "Title", "One"]);
    assert.notStrictEqual(r.code, 0);
    assert.strictEqual(page(s), before);
    assert.strictEqual(s.pushes.filter((p) => p.html || p.edits).length, 0);
    assert.strictEqual(s.saves.length, 0);
  });

  test("words that look like markup stay words", () => {
    const s = fakeSpace(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-test-"));
    run(s, ["start", s.id, "T", "One"], { dir });
    const evil = '<img src=x onerror="alert(1)"> </section><script>x()</script> <!-- & &amp; [a](javascript:alert(1))';
    D.run({ io: s.io, dir, log: () => {}, stdin: () => evil }, ["write", "1", "-"]);
    const h = page(s);
    assert.ok(!/<img|<script|<!--/i.test(h.replace(/<!doctype[^>]*>/i, "")), "no tag from the text");
    assert.ok(!/href="javascript/i.test(h), "no script link");
    assert.ok(h.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), "the words, escaped");
    for (const p of s.pushes) for (const e of p.edits || []) assert.ok(!/<img|<script/i.test(e.html || ""));
  });
};
