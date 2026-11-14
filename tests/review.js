// sheepgpt's probes of 97a9378, each a case the first tests didn't cover. Loaded by tests/run.js.
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { fakeSpace, EMPTY } = require("./fake");

module.exports = function ({ test, ROOT }) {
  const D = require(path.join(ROOT, "docs/assets/docs.js"));
  const go = (s, dir, args, stdin) => { const lines = []; const code = D.run({ io: s.io, dir, log: (l) => lines.push(String(l)), stdin: () => stdin }, args); return { code, out: lines.join("\n") }; };
  const doc = (...sections) => {
    const s = fakeSpace(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-review-"));
    go(s, dir, ["start", s.id]);
    go(s, dir, ["outline", "T", ...sections.map((_, i) => `H${i + 1}`)]);
    sections.forEach((t, i) => assert.strictEqual(go(s, dir, ["write", String(i + 1), "-"], t).code, 0));
    return { s, dir };
  };
  const body = (s) => s.files["index.html"].split("</head>")[1];

  test("review 1: a reply that says no is not a yes: apply refuses and the thread stays open", () => {
    const { s, dir } = doc("One.");
    s.person((h) => h.replace("One.", "My words."));
    go(s, dir, ["propose", "d-s1-1", "-"], "Better words.");
    const p = s.comments[s.comments.length - 1];
    for (const no of ["No. Keep my words.", "not yet", "I'd rather keep mine", "yes, but keep my words", "Don't"]) {
      s.say({ reply_to: p.id, body: no });
      const r = go(s, dir, ["apply", p.id.slice(0, 8)]);
      assert.notStrictEqual(r.code, 0, `"${no}" applied`);
      assert.ok(body(s).includes("My words."));
      assert.ok(!s.comments.find((c) => c.id === p.id).resolved);
    }
    s.say({ reply_to: p.id, body: "Yes, go ahead" });
    assert.strictEqual(go(s, dir, ["apply", p.id.slice(0, 8)]).code, 0, "a plain yes, after");
  });

  test("review 2: a person who changes only a link's address makes the block theirs", () => {
    const { s, dir } = doc("See [the lease](https://example.com/lease).");
    s.person((h) => h.replace("https://example.com/lease", "https://example.com/other"));
    const r = go(s, dir, ["edit", "d-s1-1", "-"], "Overwritten.");
    assert.notStrictEqual(r.code, 0);
    assert.ok(body(s).includes("https://example.com/other"));
  });

  test("review 3: markup typed as text is not the markup it looks like", () => {
    const { s, dir } = doc("A **Bold** word.");
    s.person((h) => h.replace("<strong>Bold</strong>", "&lt;strong&gt;Bold&lt;/strong&gt;"));
    const r = go(s, dir, ["edit", "d-s1-1", "-"], "Overwritten.");
    assert.notStrictEqual(r.code, 0);
    assert.ok(body(s).includes("&lt;strong&gt;Bold&lt;/strong&gt;"));
  });

  test("review 4: a short note already on the space is the person's: start and outline leave it", () => {
    const s = fakeSpace({ "index.html": EMPTY.replace("<body></body>", "<body><p>Call Sam about the lease.</p></body>") });
    const before = s.files["index.html"], dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-review-"));
    assert.notStrictEqual(go(s, dir, ["start", s.id]).code, 0);
    assert.notStrictEqual(go(s, dir, ["outline", "T", "H1"]).code, 0);
    assert.strictEqual(s.files["index.html"], before);
    assert.strictEqual(s.saves.length, 0);
  });

  test("review 5: a block shown removed, then kept by a clash, goes back on open tabs", () => {
    const { s, dir } = doc("Keep.\n\nGoing.\n\nAlso going.");
    s.beforeSave = (sp) => { sp.files["index.html"] = sp.files["index.html"].replace("Going.", "Going, but I typed here."); };
    s.pushes.length = 0;
    go(s, dir, ["write", "1", "-"], "Keep.");
    assert.ok(body(s).includes("Going, but I typed here."), "saved");
    const back = s.pushes.flatMap((p) => p.edits || []).filter((e) => /^insert_(after|before)$|^append_into$/.test(e.op) && (e.html || "").includes("Going, but I typed here."));
    assert.strictEqual(back.length, 1, "their block is put back on open tabs, once");
  });

  test("review 6: a section quoted as text inside a textarea is text, not the section", () => {
    const s = fakeSpace(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-review-"));
    go(s, dir, ["start", s.id]);
    go(s, dir, ["outline", "T", "H1", "H2"]);
    // The person removes section 2 and pastes its source into a textarea of their own.
    s.person((h) => h.replace(/<section data-ss-id="d-s2">[\s\S]*?<\/section>/, (m) => `<textarea>${m}</textarea>`));
    const before = s.files["index.html"];
    go(s, dir, ["write", "2", "-"], "Into the textarea?");
    const after = s.files["index.html"];
    assert.strictEqual(after.slice(after.indexOf("<textarea>"), after.indexOf("</textarea>")), before.slice(before.indexOf("<textarea>"), before.indexOf("</textarea>")), "the textarea's text is unchanged");
  });

  test("review 7: done takes the status card down instead of putting up a new one", () => {
    const { s, dir } = doc("One.");
    go(s, dir, ["write", "0", "-"], "Opening.");
    assert.strictEqual(go(s, dir, ["done"]).code, 0);
    const last = s.pushes[s.pushes.length - 1];
    assert.deepStrictEqual(last, { status: "" });
  });

  test("a section's status goes up again after its save, which takes the card down", () => {
    const { s, dir } = doc("One.");
    const seq = [];
    const push = s.io.push, save = s.io.save;
    s.io.push = (b) => { seq.push(b.status !== undefined && !b.edits ? "status" : "push"); return push(b); };
    s.io.save = (b) => { seq.push("save"); return save(b); };
    go(s, dir, ["write", "1", "-", "Writing H2"], "Two.");
    assert.deepStrictEqual(seq, ["push", "save", "status"]);
  });

  test("a placeholder holds no words: \"Writing…\" is drawn only while it's empty, so words typed into it look like words", () => {
    const s = fakeSpace(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-review-"));
    go(s, dir, ["start", s.id]);
    go(s, dir, ["outline", "T", "H1"]);
    const h = s.files["index.html"];
    assert.ok(h.includes('<p data-ss-id="d-s1-1" class="todo"></p>'), "an empty placeholder");
    const css = h.slice(h.indexOf("<style>"), h.indexOf("</style>"));
    assert.match(css, /\.todo:empty::before\s*\{[^}]*content:\s*"Writing…"/);
    assert.ok(!/(^|\n)\s*\.todo\s*\{/.test(css), "no style on a placeholder someone typed into");
    assert.match(go(s, dir, ["done"]).out, /sections 0, 1 still say "Writing…"/);
    s.person((x) => x.replace('<p data-ss-id="d-s1-1" class="todo"></p>', '<p data-ss-id="d-s1-1" class="todo">My own words.</p>'));
    assert.match(go(s, dir, ["blocks", "1"]).out, /d-s1-1\s+person\s+My own words\./);
  });
};
