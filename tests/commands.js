// What each command answers: the outline, a section, done's checks. Loaded by tests/run.js.
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { fakeSpace } = require("./fake");

module.exports = function ({ test, ROOT }) {
  const D = require(path.join(ROOT, "docs/assets/docs.js"));
  const go = (s, dir, args, stdin) => { const lines = []; const code = D.run({ io: s.io, dir, log: (l) => lines.push(String(l)), stdin: () => stdin }, args); return { code, out: lines.join("\n") }; };
  const fresh = (pages) => {
    const s = fakeSpace(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-test-"));
    assert.strictEqual(go(s, dir, ["start", s.id]).code, 0);
    const args = ["outline", "A proposal", "One", "Two"];
    if (pages) args.push("--pages", String(pages));
    assert.strictEqual(go(s, dir, args).code, 0);
    return { s, dir };
  };
  const writeAll = (s, dir) => { for (const n of [0, 1, 2]) assert.strictEqual(go(s, dir, ["write", String(n), "-"], `Section ${n} words.`).code, 0); };

  test("start shows a status first; outline then draws the title and headings, and saves them", () => {
    const { s } = fresh();
    assert.deepStrictEqual(s.pushes.map((p) => Object.keys(p).join()), ["status", "html", "status"], "the status goes back up after the outline's save");
    assert.strictEqual(s.saves.length, 1);
    const h = s.files["index.html"];
    for (const id of ["d-title", "d-s0-1", "d-s1-h", "d-s1-1", "d-s2-h", "d-s2-1"]) assert.ok(h.includes(`data-ss-id="${id}"`), id);
    assert.ok(D.ledgerOf(h), "the ledger is in the head");
  });

  test("a section goes to open tabs and is saved as exact changes, not a whole page", () => {
    const { s, dir } = fresh();
    s.pushes.length = 0;
    go(s, dir, ["write", "1", "-", "Writing Two"], "First.\n\nSecond.");
    assert.strictEqual(s.pushes.length, 2, "the section, then its status again after the save");
    assert.strictEqual(s.pushes[0].status, "Writing Two");
    assert.deepStrictEqual(s.pushes[1], { status: "Writing Two" });
    assert.deepStrictEqual(s.pushes[0].edits.map((e) => e.op), ["replace", "append_into"]);
    const last = s.saves[s.saves.length - 1];
    assert.ok(!last.files && last.replacements.length === 2, "the section and the ledger");
    assert.deepStrictEqual(last.live_patch, s.pushes[0].edits);
  });

  test("done refuses while a section still says Writing…", () => {
    const { s, dir } = fresh();
    go(s, dir, ["write", "0", "-"], "Opening.");
    const r = go(s, dir, ["done"]);
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /sections 1, 2 still say/);
  });

  test("done refuses a document longer than the length asked for, and says by how much", () => {
    const { s, dir } = fresh(1);
    writeAll(s, dir);
    s.pages = 3;
    const r = go(s, dir, ["done"]);
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /prints on 3 A4 pages, and the person asked for 1\. Cut about \d+ of its \d+ words/);
    assert.match(r.out, /words by section: 0: 3, 1: 3, 2: 3/);
    s.pages = 1;
    const ok = go(s, dir, ["done"]);
    assert.strictEqual(ok.code, 0);
    assert.match(ok.out, /prints on 1 A4 page, as asked/);
  });

  test("done lists the bracketed blanks for the reply", () => {
    const { s, dir } = fresh();
    go(s, dir, ["write", "0", "-"], "Dear [landlord's name], about [flat address].");
    go(s, dir, ["write", "1", "-"], "From [start date].");
    go(s, dir, ["write", "2", "-"], "Thanks.");
    const r = go(s, dir, ["done"]);
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /\[landlord's name\], \[flat address\], \[start date\]/);
  });

  test("text marks become only their own tags", () => {
    const b = D.blocksFromText("**bold** and *it* and [a link](https://example.com/?a=1&b=2)\n\n- one\n- two\n\n1. first\n\n### Sub\n\n> quoted");
    assert.deepStrictEqual(b.map((x) => x.tag), ["p", "ul", "ol", "h3", "blockquote"]);
    assert.strictEqual(b[0].html, '<strong>bold</strong> and <em>it</em> and <a href="https://example.com/?a=1&amp;b=2">a link</a>');
  });

  test("done says a far-over length at once, without printing", () => {
    const { s, dir } = fresh(1);
    const long = Array(80).fill("This sentence has exactly eight words in it.").join(" ");
    for (const n of [0, 1, 2]) go(s, dir, ["write", String(n), "-"], long);
    let printed = 0; s.io.pdfPages = () => { printed++; return 1; };
    const r = go(s, dir, ["done"]);
    assert.strictEqual(r.code, 1);
    assert.strictEqual(printed, 0, "no PDF for a document three times too long");
    assert.match(r.out, /the person asked for 1/);
  });

  test("done refuses a blank that holds an alternative sentence", () => {
    const { s, dir } = fresh();
    go(s, dir, ["write", "0", "-"], "They would live there alone [or: with whoever else will live there].");
    go(s, dir, ["write", "1", "-"], "One.");
    go(s, dir, ["write", "2", "-"], "Two.");
    const r = go(s, dir, ["done"]);
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /\[or: with whoever else will live there\] is an alternative inside a blank/);
    go(s, dir, ["write", "0", "-"], "They would live there [alone, or with whom].");
    assert.strictEqual(go(s, dir, ["done"]).code, 0);
  });

  test("a blank is marked for the screen and Tab, and done still lists it", () => {
    const b = D.blocksFromText("Dear [landlord's name], see [the lease](https://example.com) and item a[1].");
    assert.strictEqual(b[0].html, 'Dear <mark class="blank" tabindex="0">[landlord&#39;s name]</mark>, see <a href="https://example.com">the lease</a> and item a[1].');
    const { s, dir } = fresh();
    go(s, dir, ["write", "0", "-"], "Dear [landlord's name],");
    go(s, dir, ["write", "1", "-"], "From [start date].");
    go(s, dir, ["write", "2", "-"], "Thanks.");
    assert.match(go(s, dir, ["done"]).out, /\[landlord's name\], \[start date\]/);
    const css = fs.readFileSync(path.join(ROOT, "docs/references/page.html"), "utf8");
    assert.match(css, /@media print \{[\s\S]*mark\.blank \{ background: none/, "plain brackets in print");
  });
};
