// A fake space for the tests: its files, its versions, the live pushes it was sent, and a person who
// changes the page between commands. Saves behave as create_version does: whole files, or exact
// replacements whose old text must appear once in the current file, else a conflict.
"use strict";

const EMPTY = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>new</title></head><body></body></html>\n';

function fakeSpace(files = { "index.html": EMPTY }) {
  let v = 1;
  const s = {
    id: "00000000-0000-4000-8000-000000000001",
    files: Object.assign({}, files),
    pushes: [], saves: [], statuses: [],
    beforeSave: null, // a person's change that lands between the tool's read and its save, once
    head: () => "v" + v,
    io: {
      read() { return { version: "v" + v, files: Object.assign({}, s.files) }; },
      push(body) { s.pushes.push(JSON.parse(JSON.stringify(body))); if (body.status) s.statuses.push(body.status); return { tabs_open: 1 }; },
      save(body) {
        if (s.beforeSave) { const f = s.beforeSave; s.beforeSave = null; f(s); }
        if (body.files) {
          if (body.parent !== "v" + v) { const e = new Error("conflict"); e.code = "conflict"; throw e; }
          for (const f of body.files) s.files[f.path] = f.content;
        } else {
          const next = Object.assign({}, s.files);
          for (const r of body.replacements) {
            const p = r.path || "index.html", cur = next[p] || "";
            const n = cur.split(r.old_string).length - 1;
            if (n !== 1) { const e = new Error(`conflict: ${p}: old text found ${n} times`); e.code = "conflict"; throw e; }
            next[p] = cur.replace(r.old_string, () => r.new_string);
          }
          s.files = next;
        }
        s.saves.push(JSON.parse(JSON.stringify(body)));
        v++;
        return { version: "v" + v };
      },
      pdfPages() { return s.pages || 1; },
    },
    // A person's edit on the saved page, as the room saves it: a new version.
    person(fn) { s.files["index.html"] = fn(s.files["index.html"]); v++; },
  };
  return s;
}

module.exports = { fakeSpace, EMPTY };
