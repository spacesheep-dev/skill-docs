// Docs' starter with lines the person typed on it: Docs' page to write on. Every typed line stays where it is,
// byte for byte, on open tabs and in every save; the document goes after them; start quotes them to the agent.
// Anything else on the starter makes the page the person's, as before. Loaded by tests/run.js.
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { fakeSpace } = require("./fake");

module.exports = function ({ test, ROOT }) {
  const D = require(path.join(ROOT, "docs/assets/docs.js"));
  const starter = fs.readFileSync(path.join(ROOT, "docs/references/page.html"), "utf8");
  const go = (s, dir, args, stdin) => { const lines = []; const code = D.run({ io: s.io, dir, log: (l) => lines.push(String(l)), stdin: () => stdin }, args); return { code, out: lines.join("\n") }; };
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "docs-typed-"));
  const count = (hay, needle) => hay.split(needle).length - 1;
  // The two places the app saves a first line on the starter: inside its <main> (from 16 Nov 2026), and in
  // <body> above it (before). Both as the app writes them: a bare element on its own line.
  const inMain = (lines) => starter.replace('<main data-ss-id="d-doc">\n', `<main data-ss-id="d-doc">\n${lines}\n`);
  const aboveMain = (lines) => starter.replace('<body>\n', `<body>\n${lines}\n`);

  // The whole run on a page with typed lines: each one is checked after every command, saved and on open tabs.
  const walk = (page, lines, outline) => {
    const s = fakeSpace({ "index.html": page }), dir = tmp(), runs = [];
    const check = (what) => {
      for (const l of lines) assert.strictEqual(count(s.files["index.html"], l), 1, `${what}: ${l} kept as typed`);
      for (const p of s.pushes) {
        assert.ok(!p.html, `${what}: no whole page pushed over the person's lines`);
        for (const e of p.edits || []) for (const l of lines) assert.ok(!(e.html || "").includes(l), `${what}: a live ${e.op} carries ${l}`);
      }
      for (const v of s.saves) {
        assert.ok(!v.files, `${what}: no whole-page save over the person's lines`);
        for (const r of v.replacements || []) for (const l of lines) assert.strictEqual(count(r.old_string, l), count(r.new_string, l), `${what}: a save changes ${l}`);
      }
    };
    for (const args of [["start", s.id], outline, ["write", "0", "-", "Why I'm writing."], ["write", "1", "-", "The first part."], ["write", "2", "-", "The second part."], ["blocks"], ["done"]]) {
      const stdin = args[0] === "write" ? args.pop() : null;
      const r = go(s, dir, args, stdin);
      assert.strictEqual(r.code, 0, `${args[0]}: ${r.out}`);
      runs.push(r);
      check(args.join(" "));
    }
    return { s, runs, page: s.files["index.html"] };
  };

  test("a typed line inside the starter's main: start quotes it as the person's, and the document goes in after it", () => {
    const line = "<p>Hello from a blank Docs page</p>";
    const { s, runs, page } = walk(inMain(line), [line], ["outline", "A letter", "One", "Two"]);
    assert.match(runs[0].out, /blank but for a line the person typed[\s\S]*\n  "Hello from a blank Docs page"\n/);
    assert.match(runs[0].out, /outline --their-title/);
    assert.ok(page.indexOf(line) > page.indexOf('<main data-ss-id="d-doc">') && page.indexOf(line) < page.indexOf('data-ss-id="d-title"'), "their line first in main, then the title");
    assert.ok(page.includes("The second part.") && /<h1 data-ss-id="d-title">A letter<\/h1>/.test(page));
    const appended = s.pushes.flatMap((p) => p.edits || []).find((e) => e.op === "append_into" && e.anchor === "d-doc");
    assert.ok(appended && appended.html.startsWith('<h1 data-ss-id="d-title">'), "the outline went to open tabs as one append into the document");
    assert.match(runs[6].out, /the person wrote 1 block on the page, left as they wrote it: 1 outside the sections/);
    assert.ok(!runs[6].out.includes("Hello from"), "done doesn't quote it");
  });

  test("a typed line above the starter's main, where the app saved it before: it stays there, and the document goes in main", () => {
    const line = "<p>Hello from a blank Docs page</p>";
    const { page } = walk(aboveMain(line), [line], ["outline", "A letter", "One", "Two"]);
    assert.ok(page.indexOf(line) < page.indexOf('<main data-ss-id="d-doc">'), "still above main");
    assert.ok(page.indexOf('data-ss-id="d-title"') > page.indexOf('<main data-ss-id="d-doc">'));
  });

  test("a typed heading, a list and several lines all stay, in their order", () => {
    const lines = ["<h1>Bins on Elm Road</h1>", "<p>For the council, <b>by Friday</b>.</p>", "<ul>\n<li>missed twice</li>\n<li>lids broken</li>\n</ul>", "<p>Keep it short.</p>"];
    const r = walk(inMain(lines.join("\n")), lines, ["outline", "Bins", "One", "Two"]);
    assert.ok(lines.every((l, i) => i === 0 || r.page.indexOf(l) > r.page.indexOf(lines[i - 1])), "in their order");
    assert.match(r.runs[0].out, /blank but for 4 lines[\s\S]*"Bins on Elm Road"\n  "For the council, by Friday."\n  "missed twice lids broken"\n  "Keep it short."/);
  });

  test("their first line as the title: the outline has no title of the tool's, the tab takes their words, and done passes", () => {
    const line = "<p>Letter to the council about the bins</p>";
    const { runs, page } = walk(inMain(line), [line], ["outline", "--their-title", "One", "Two"]);
    assert.ok(!page.includes('data-ss-id="d-title"'), "no title of the tool's");
    assert.match(page, /<title>Letter to the council about the bins<\/title>/);
    assert.ok(page.indexOf(line) < page.indexOf('<section data-ss-id="d-s0"'), "their title first, then the opening");
    assert.match(runs[1].out, /under the person's title, 2 headings are on the page/);
    assert.match(runs[6].out, /checked and saved/);
    // On a page with no typed line there's no title of theirs to keep: refused, nothing saved.
    const s = fakeSpace({ "index.html": starter }), dir = tmp();
    go(s, dir, ["start", s.id]);
    const r = go(s, dir, ["outline", "--their-title", "One"]);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /no line the person typed to be its title/);
    assert.strictEqual(s.saves.length, 0);
  });

  test("a typed line that lands while the outline goes in: nothing saved, the outline comes off open tabs, their lines stay", () => {
    const line = "<p>Hello</p>", later = "<p>And one more thing.</p>";
    const s = fakeSpace({ "index.html": inMain(line) }), dir = tmp();
    go(s, dir, ["start", s.id]);
    s.beforeSave = (sp) => { sp.files["index.html"] = sp.files["index.html"].replace(line, `${line}\n${later}`); };
    const r = go(s, dir, ["outline", "T", "One"]);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /changed the page while the outline went in/);
    assert.strictEqual(s.files["index.html"], inMain(`${line}\n${later}`), "their page, as they left it");
    assert.deepStrictEqual(s.pushes[s.pushes.length - 1].edits.map((e) => e.op + " " + e.anchor), ["remove d-title", "remove d-s0", "remove d-s1"]);
    const again = go(s, dir, ["outline", "T", "One"]);
    assert.strictEqual(again.code, 0, again.out);
    assert.ok(s.files["index.html"].includes(`${line}\n${later}\n<h1 data-ss-id="d-title">T</h1>`));
  });

  test("the starter with anything but typed lines is still the person's: refused, and left as it was", () => {
    const off = [
      inMain('<p>Mine.</p>\n<img src="plan.png">'),
      inMain("<p>Mine.</p>\n<canvas></canvas>"),
      inMain("<p>Mine.<script>x()</script></p>"),
      inMain('<p onclick="x()">Mine.</p>'),
      inMain('<p style="color:red">Mine.</p>'),
      inMain('<p><a href="javascript:alert(1)">Mine.</a></p>'),
      inMain('<p><a href=" java\tscript:alert(1)">Mine.</a></p>'),
      inMain('<p data-ss-id="d-title">Mine.</p>'),
      inMain("<div>Mine.</div>"),
      inMain("<table><tr><td>Mine.</td></tr></table>"),
      inMain("<p>Mine.</p>\nA loose word"),
      inMain("<p>Mine.</p>").replace("</main>", "</main>\n<p>After main.</p>"),
      inMain("<p>Mine.</p>").replace("</head>", "<script>draw()</script>\n</head>"),
      inMain("<p>Mine.</p>").replace("--paper: #fdfcfa", "--paper: #000000"),
      inMain("<p>Mine.</p>").replace("<title>Document</title>", "<title>Mine</title>"),
      inMain("<p>Mine.</p>").replace('<main data-ss-id="d-doc">', '<main data-ss-id="d-doc" class="mine">'),
    ];
    for (const page of off) {
      const s = fakeSpace({ "index.html": page }), dir = tmp();
      const start = go(s, dir, ["start", s.id]), outline = go(s, dir, ["outline", "T", "One"]);
      assert.notStrictEqual(start.code, 0, `refused: ${page.slice(page.indexOf("<body>"), page.indexOf("<body>") + 120)}`);
      assert.match(start.out, /never written over/);
      assert.notStrictEqual(outline.code, 0);
      assert.strictEqual(s.files["index.html"], page);
      assert.strictEqual(s.saves.length, 0);
      assert.ok(!s.pushes.some((p) => p.html || p.edits), "nothing drawn on it");
    }
  });
};
