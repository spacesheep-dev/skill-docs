// A Docs page opens in Edit: it carries <meta name="ss-edit" content="open"> in its head, which Spacesheep's frame
// reads when the page loads. The starter has it. A page of this skill made before (Docs 1.0.0 to 1.0.2) gets it
// with its next save, once, right after the ledger; start only reads. A meta of that name the page has already,
// with any value, stays as it is. The old starter, blank or with typed lines, is still Docs' page to write on.
// Loaded by tests/run.js.
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { fakeSpace } = require("./fake");

module.exports = function ({ test, ROOT }) {
  const D = require(path.join(ROOT, "docs/assets/docs.js"));
  const starter = fs.readFileSync(path.join(ROOT, "docs/references/page.html"), "utf8");
  const old = fs.readFileSync(path.join(ROOT, "docs/assets/blank-starter-1.0.html"), "utf8");
  const META = '<meta name="ss-edit" content="open">';
  const go = (s, dir, args, stdin) => { const lines = []; const code = D.run({ io: s.io, dir, log: (l) => lines.push(String(l)), stdin: () => stdin }, args); return { code, out: lines.join("\n") }; };
  const ok = (s, dir, args, stdin) => { const r = go(s, dir, args, stdin); assert.strictEqual(r.code, 0, `${args.join(" ")}: ${r.out}`); return r; };
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "docs-edit-"));
  const count = (hay, needle) => hay.split(needle).length - 1;
  const head = (html) => html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  // One meta, in the head, right after the ledger.
  const once = (html, what) => {
    assert.strictEqual(count(html, "ss-edit"), 1, `${what}: one ss-edit`);
    assert.ok(head(html).includes(META), `${what}: in the head`);
    assert.match(html, /<meta name="docs-ledger" content="[^"]*">\n<meta name="ss-edit" content="open">\n/, `${what}: right after the ledger`);
  };
  // A document as Docs 1.0.2 left it: the same page with no meta (its starter was this one without the line).
  const legacy = () => {
    const s = fakeSpace(), dir = tmp();
    ok(s, dir, ["start", s.id]);
    ok(s, dir, ["outline", "Plan", "A", "B"]);
    for (const n of ["0", "1", "2"]) ok(s, dir, ["write", n, "-"], `Section ${n}.`);
    s.person((h) => h.replace("\n" + META, ""));
    assert.strictEqual(count(s.files["index.html"], "ss-edit"), 0);
    s.saves.length = 0; s.pushes.length = 0;
    return { s, dir };
  };

  test("the starter opens in Edit: one meta, in its head, right after the ledger; the old starter is the same page without it", () => {
    once(starter, "starter");
    assert.strictEqual(starter.replace(META + "\n", ""), old, "nothing else changed in the starter");
  });

  test("a new document carries it through the whole run, once", () => {
    const s = fakeSpace(), dir = tmp();
    ok(s, dir, ["start", s.id]);
    ok(s, dir, ["outline", "Plan", "A", "B"]);
    once(s.files["index.html"], "outline");
    for (const n of ["0", "1", "2"]) ok(s, dir, ["write", n, "-"], `Section ${n}.`);
    assert.match(ok(s, dir, ["done"]).out, /checked and saved/);
    once(s.files["index.html"], "done");
  });

  test("a page Docs made before: start saves nothing, its next save adds the meta once, and later saves keep it at one", () => {
    const { s, dir } = legacy();
    ok(s, dir, ["start", s.id]);
    assert.strictEqual(s.saves.length, 0, "start only reads");
    assert.strictEqual(count(s.files["index.html"], "ss-edit"), 0);
    ok(s, dir, ["write", "1", "-"], "Section 1, again.");
    once(s.files["index.html"], "first save");
    assert.ok(!s.pushes.some((p) => p.html || (p.edits || []).some((e) => (e.html || "").includes("ss-edit"))), "nothing about it goes to open tabs");
    ok(s, dir, ["write", "2", "-"], "Section 2, again.");
    ok(s, dir, ["done"]);
    once(s.files["index.html"], "after done");
  });

  test("every kind of save adds it to a page made before: edit, propose, apply, and done's Checked save", () => {
    const run = (fn) => { const { s, dir } = legacy(); fn(s, dir); assert.ok(s.saves.length >= 1); once(s.files["index.html"], fn.name); };
    run(function edit(s, dir) { ok(s, dir, ["edit", "d-s1-1", "-"], "Changed."); });
    run(function done(s, dir) { ok(s, dir, ["done"]); assert.strictEqual(s.saves.length, 1); assert.strictEqual(s.saves[0].label, "Checked"); });
    run(function propose(s, dir) {
      s.person((h) => h.replace(/(<p data-ss-id="d-s1-1">)[^<]*/, "$1Their own line."));
      ok(s, dir, ["propose", "d-s1-1", "-", "tighter"], "A tighter line.");
      assert.strictEqual(s.saves.length, 1);
    });
    run(function apply(s, dir) {
      s.person((h) => h.replace(/(<p data-ss-id="d-s1-1">)[^<]*/, "$1Their own line."));
      ok(s, dir, ["propose", "d-s1-1", "-", "tighter"], "A tighter line.");
      s.person((h) => h.replace("\n" + META, "")); // the proposal's save added it: take it off, so apply's save must
      const c = s.comments[s.comments.length - 1];
      s.say({ reply_to: c.id, body: "yes" });
      ok(s, dir, ["apply", c.id.slice(0, 8)]);
      assert.ok(s.files["index.html"].includes("A tighter line."));
    });
  });

  test("a meta of that name the page has already, with any value or quoting, stays as it is and gets no second", () => {
    for (const has of ['<meta name="ss-edit" content="closed">', "<meta name='ss-edit' content='open'>", '<meta content="open" name=ss-edit>', '<meta name="SS-EDIT" content="open">',
      // After b6f72ff's review: the name as the browser decodes it, and the first name attribute only.
      '<meta name="ss&#45;edit" content="closed">', '<meta name="ss&#x2D;edit" content="closed">', '<meta name="ss&#45edit" content="closed">', '<meta name=&#115;s-edit content="closed">',
      '<META NAME="ss-edit" CONTENT="closed">', '<meta/name="ss-edit"/content="closed"/>', '<meta name = "ss-edit" content="closed">', '<meta name="ss-edit" name="description" content="closed">']) {
      const { s, dir } = legacy();
      s.person((h) => h.replace("</head>", has + "\n</head>"));
      const legacyPage = s.files["index.html"].replace(has, "");
      ok(s, dir, ["write", "1", "-"], "Again.");
      ok(s, dir, ["done"]);
      assert.strictEqual(count(s.files["index.html"].toLowerCase(), "<meta"), count(legacyPage.toLowerCase(), "<meta") + 1, `${has}: no meta added`);
      assert.ok(s.files["index.html"].includes(has), `${has} as it was`);
    }
  });

  test("after b6f72ff's review: ss-edit anywhere but a meta's own name isn't the meta, and the page still gets the real one", () => {
    for (const other of [`<meta name="description" content='Use name="ss-edit" for editing'>`, '<meta property="og:x" content="name=ss-edit">', '<meta data-name="ss-edit" content="closed">',
      '<meta name="ss-edit-x" content="closed">', '<meta name="description" name="ss-edit" content="closed">', '<meta name="ss&amp;edit" content="closed">', '<meta name="ss&#8208;edit" content="closed">',
      '<meta name="ss-ed&#304;t" content="closed">', '<metax name="ss-edit" content="closed">', '<template><meta name="ss-edit" content="closed"></template>']) {
      const { s, dir } = legacy();
      s.person((h) => h.replace("</head>", other + "\n</head>"));
      ok(s, dir, ["write", "1", "-"], "Again.");
      const h = s.files["index.html"];
      assert.strictEqual(count(h, META), 1, `${other}: the real one added`);
      assert.match(h, /<meta name="docs-ledger" content="[^"]*">\n<meta name="ss-edit" content="open">\n/, other);
      assert.ok(h.includes(other), `${other} as it was`);
    }
  });

  test("a copy in a comment or in a script isn't the meta: the page still gets the real one", () => {
    for (const fake of [`<!-- ${META} -->`, `<script>var x = '${META}';</script>`]) {
      const { s, dir } = legacy();
      s.person((h) => h.replace("</head>", fake + "\n</head>"));
      ok(s, dir, ["write", "1", "-"], "Again.");
      const h = s.files["index.html"];
      assert.strictEqual(count(h, META), 2, `${fake}: the copy, and the real one`);
      assert.match(h, /<meta name="docs-ledger" content="[^"]*">\n<meta name="ss-edit" content="open">\n/);
    }
  });

  test("a ledger outside the head gets no meta beside it", () => {
    const { s, dir } = legacy();
    s.person((h) => { const t = /<meta name="docs-ledger" content="[^"]*">\n/.exec(h)[0]; return h.replace(t, "").replace("<main", t + "<main"); });
    ok(s, dir, ["write", "1", "-"], "Again.");
    assert.strictEqual(count(s.files["index.html"], "ss-edit"), 0);
  });

  test("the old starter is still blank: outline writes on it, and the page opens in Edit after", () => {
    const s = fakeSpace({ "index.html": old }), dir = tmp();
    assert.doesNotMatch(ok(s, dir, ["start", s.id]).out, /blank but for/);
    ok(s, dir, ["outline", "Plan", "A", "B"]);
    once(s.files["index.html"], "outline on the old starter");
  });

  test("the old starter with a typed line: the line stays as typed, first, and the outline's save adds the meta", () => {
    const line = "<p>Hello from an old blank Docs page</p>";
    const s = fakeSpace({ "index.html": old.replace('<main data-ss-id="d-doc">\n', `<main data-ss-id="d-doc">\n${line}\n`) }), dir = tmp();
    assert.match(ok(s, dir, ["start", s.id]).out, /blank but for a line the person typed[\s\S]*"Hello from an old blank Docs page"/);
    ok(s, dir, ["outline", "--their-title", "A", "B"]);
    const h = s.files["index.html"];
    once(h, "typed outline");
    assert.strictEqual(count(h, line), 1);
    assert.ok(h.indexOf(line) < h.indexOf('<section data-ss-id="d-s0"'));
    assert.ok(!s.saves[0].files, "exact changes, not a whole page over their line");
    for (const r of s.saves[0].replacements) assert.strictEqual(count(r.old_string, line), count(r.new_string, line));
  });

  test("either starter with anything but typed lines is the person's: refused, nothing saved", () => {
    for (const base of [starter, old]) {
      const s = fakeSpace({ "index.html": base.replace("</main>", '<img src="x.png"></main>') }), dir = tmp();
      assert.notStrictEqual(go(s, dir, ["start", s.id]).code, 0);
      assert.strictEqual(s.saves.length, 0);
    }
  });
};
