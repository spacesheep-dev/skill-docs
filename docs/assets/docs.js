#!/usr/bin/env node
// Every command the Docs skill runs, so a person allows this one script. It talks to one space through the
// spacesheep CLI (the one on the PATH, else npx's copy), and writes only inside the folder given with -C.
//
//   node docs.js -C <folder> start <link>  a status on the space at once, then what it holds: nothing yet (and how
//                                          to write the outline), or a document (its blocks, whose each is, and
//                                          the rest of the skill). start --new "<title>" makes a new space.
//   node docs.js -C <folder> outline "<title>" "<heading>" ... [--pages n]   the title and every heading, each
//                                          section saying "Writing…", on open tabs and saved.
//   node docs.js -C <folder> write <n> <file|-> ["<status>"]           section n (0 is the opening, before the
//                                          first heading) from plain text: shown on open tabs, then saved.
//   node docs.js -C <folder> blocks [n]    each block: its id, whose it is, its words. Only reads.
//   node docs.js -C <folder> done          checks nothing still says "Writing…", then says it's ready.
//
// The agent writes text, never HTML: paragraphs split by a blank line, "- " lines a list, "1. " lines a numbered
// list, a "### " line a subheading, "> " lines a quote, **bold**, *italics* and [words](https://link). Every
// character of it is escaped; nothing in it becomes a tag, an attribute or a script.
//
// Whose a block is: the tool's when it made the block's id, the id appears once, and the block still reads as
// the tool last wrote it (the ledger in the page's head holds a hash per block). Anything else is the
// person's: a block they typed in, one they added, with an id or without, an id that appears twice. No command
// changes, moves or removes a person's block, on open tabs or in a save. New blocks go at the end of their
// section, after whatever is there.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync, execSync } = require("child_process");

const STARTER = path.join(__dirname, "..", "references", "page.html");
const WRITING = path.join(__dirname, "..", "references", "writing.md");
const OUTLINE = path.join(__dirname, "..", "references", "outline.md");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER = "Writing…";

// --- reading a page: elements, their ids, their spans (pure) ---
const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const TAG = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const attr = (attrs, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs || ""); return m ? (m[2] !== undefined ? m[2] : m[3]) : null; };
// A tree of elements: {name, id, start, openEnd, closeStart, end, children}. Lenient: an unclosed element ends
// where its parent does; script and style bodies are skipped whole.
function parse(html) {
  const root = { name: "#root", start: 0, openEnd: 0, closeStart: html.length, end: html.length, children: [] };
  const stack = [root];
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    const name = m[2].toLowerCase(), close = m[1] === "/";
    if (!close) {
      const el = { name, id: attr(m[3], "data-ss-id"), cls: attr(m[3], "class"), start: m.index, openEnd: m.index + m[0].length, closeStart: null, end: null, children: [], parent: stack[stack.length - 1] };
      el.parent.children.push(el);
      if (VOID.has(name) || /\/\s*$/.test(m[3])) { el.closeStart = el.end = el.openEnd; continue; }
      if (name === "script" || name === "style") {
        const endTag = new RegExp(`</${name}\\s*>`, "ig"); endTag.lastIndex = el.openEnd;
        const e = endTag.exec(html);
        el.closeStart = e ? e.index : html.length; el.end = e ? e.index + e[0].length : html.length;
        TAG.lastIndex = el.end;
        continue;
      }
      stack.push(el);
    } else {
      let i = stack.length - 1;
      while (i > 0 && stack[i].name !== name) i--;
      if (i === 0) continue; // a stray close
      while (stack.length - 1 > i) { const x = stack.pop(); x.closeStart = x.end = m.index; }
      const el = stack.pop(); el.closeStart = m.index; el.end = m.index + m[0].length;
    }
  }
  while (stack.length > 1) { const x = stack.pop(); x.closeStart = x.end = html.length; }
  return root;
}
function walk(el, fn) { for (const c of el.children) { fn(c); walk(c, fn); } }
function idCounts(root) { const n = Object.create(null); walk(root, (e) => { if (e.id) n[e.id] = (n[e.id] || 0) + 1; }); return n; }
function byId(root, id) { let hit = null, n = 0; walk(root, (e) => { if (e.id === id) { hit = hit || e; n++; } }); return n === 1 ? hit : null; }
const outer = (html, el) => html.slice(el.start, el.end);
const inner = (html, el) => html.slice(el.openEnd, el.closeStart);

// --- words: what a block reads, and its hash ---
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m));
// A block's words and inline tags, without attributes or spacing: what a person changes when they type.
const norm = (s) => decode(s.replace(/<(\/?)([a-zA-Z][\w-]*)[^>]*>/g, (m, c, n) => `<${c}${n.toLowerCase()}>`)).replace(/\s+/g, " ").trim();
const words = (s) => decode(s.replace(/<br\s*\/?>|<\/(?:li|p|h\d|blockquote)>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const sig = (html, el) => crypto.createHash("sha256").update(el.name + ":" + norm(inner(html, el))).digest("hex").slice(0, 16);

// --- text in, markup out: every character escaped first, then only these few marks become tags ---
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
function inline(s) {
  let h = esc(s);
  h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (m, t, u) => `<a href="${u}">${t}</a>`);
  h = h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  return h;
}
// Plain text to blocks: [{tag, html}] where html is the block's inside.
function blocksFromText(text) {
  const out = [];
  for (const chunk of String(text).replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) out.push({ tag: "ul", html: lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>`).join("") });
    else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) out.push({ tag: "ol", html: lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("") });
    else if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0])) out.push({ tag: "h3", html: inline(lines[0].replace(/^#{1,6}\s+/, "")) });
    else if (lines.every((l) => /^>\s?/.test(l))) out.push({ tag: "blockquote", html: lines.map((l) => inline(l.replace(/^>\s?/, ""))).join("<br>") });
    else out.push({ tag: "p", html: lines.map((l) => inline(l.trim())).join("<br>") });
  }
  return out;
}
const render = (b, id, cls) => `<${b.tag} data-ss-id="${id}"${cls ? ` class="${cls}"` : ""}>${b.html}</${b.tag}>`;
const blockSig = (b) => crypto.createHash("sha256").update(b.tag + ":" + norm(b.html)).digest("hex").slice(0, 16);

// --- the ledger: in the page's head, so one read gives the page and whose each block is ---
const LEDGER = /<meta name="docs-ledger" content="([^"]*)">/;
function ledgerOf(html) { const m = LEDGER.exec(html); if (!m) return null; try { return JSON.parse(decode(m[1])); } catch { return null; } }
const ledgerTag = (L) => `<meta name="docs-ledger" content="${esc(JSON.stringify(L))}">`;

// Whose each block of a section is, and where the section is.
function sectionView(html, root, L, n) {
  const sec = byId(root, `d-s${n}`);
  if (!sec) return null;
  const counts = idCounts(root), head = `d-s${n}-h`;
  const body = sec.children.filter((c) => c.id !== head);
  const mineOf = (c) => !!(c.id && L.blocks[c.id] && counts[c.id] === 1 && sig(html, c) === L.blocks[c.id]);
  return { sec, body, mine: body.filter(mineOf), mineOf };
}

// Section n rewritten from text: the save's replacements, the live edits, the new ledger, what was kept.
function planWrite(html, n, text) {
  const L = ledgerOf(html);
  if (!L) throw new Error("this page has no ledger: it isn't a document from this skill, so every block is the person's");
  const root = parse(html), v = sectionView(html, root, L, n);
  if (!v) throw new Error(`there's no section ${n}: sections run from 0 to ${L.sections}`);
  const news = blocksFromText(text), NL = JSON.parse(JSON.stringify(L)), key = `d-s${n}`;
  NL.next[key] = NL.next[key] || 1;
  // Ids of this section the tool made but no longer holds: the person's now, for good.
  const kept = [];
  for (const c of v.body) if (c.id && L.blocks[c.id] && !v.mineOf(c)) { delete NL.blocks[c.id]; kept.push(c.id); }
  const splices = [], edits = [], appended = [];
  for (let i = 0; i < Math.max(v.mine.length, news.length); i++) {
    const was = v.mine[i], b = news[i];
    if (was && b) {
      if (blockSig(b) === L.blocks[was.id] && was.name === b.tag) continue;
      const h = render(b, was.id);
      splices.push([was.start, was.end, h]); edits.push({ anchor: was.id, op: "replace", html: h }); NL.blocks[was.id] = blockSig(b);
    } else if (b) {
      const id = `${key}-${NL.next[key]++}`, h = render(b, id);
      appended.push(h); NL.blocks[id] = blockSig(b);
    } else {
      let end = was.end; if (html[end] === "\n") end++;
      splices.push([was.start, end, ""]); edits.push({ anchor: was.id, op: "remove" }); delete NL.blocks[was.id];
    }
  }
  if (appended.length) { splices.push([v.sec.closeStart, v.sec.closeStart, appended.join("\n") + "\n"]); edits.push({ anchor: key, op: "append_into", html: appended.join("\n") }); }
  if (!splices.length && !kept.length) return { edits: [], replacements: [], kept, changed: 0 };
  // The section as the save sends it: its whole source, old and new, so a change anyone made inside it since
  // this read is a clash, not an overwrite.
  const secOld = outer(html, v.sec);
  let secNew = secOld;
  for (const [a, b, h] of splices.sort((x, y) => y[0] - x[0])) secNew = secNew.slice(0, a - v.sec.start) + h + secNew.slice(b - v.sec.start);
  const replacements = [];
  if (secNew !== secOld) replacements.push({ old_string: secOld, new_string: secNew });
  replacements.push({ old_string: LEDGER.exec(html)[0], new_string: ledgerTag(NL) });
  return { edits, replacements, kept, changed: edits.length, ledger: NL };
}

// The starter with this document's title and headings, each with a placeholder.
function buildPage(starter, title, headings, pages) {
  const L = { v: 1, sections: headings.length, pages: pages || null, next: {}, blocks: {} };
  const ph = { tag: "p", html: esc(PLACEHOLDER) };
  const blk = (b, id, cls) => { L.blocks[id] = blockSig(b); return render(b, id, cls); };
  const parts = [blk({ tag: "h1", html: esc(title) }, "d-title")];
  const secs = ["", ...headings];
  secs.forEach((hd, n) => {
    const key = `d-s${n}`; L.next[key] = 2;
    const lines = [`<section data-ss-id="${key}">`];
    if (n) lines.push(blk({ tag: "h2", html: esc(hd) }, `${key}-h`));
    lines.push(blk(ph, `${key}-1`, "todo"));
    lines.push("</section>");
    parts.push(lines.join("\n"));
  });
  const swaps = [
    [/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>`],
    [/<meta name="docs-ledger" content="[^"]*">/, () => ledgerTag(L)],
    [/(<main data-ss-id="d-doc"[^>]*>)[\s\S]*?(<\/main>)/, (m, a, b) => `${a}\n${parts.join("\n")}\n${b}`],
  ];
  let page = starter;
  for (const [re, to] of swaps) { if (!re.test(page)) throw new Error(`the starter has no ${re.source.slice(0, 30)}`); page = page.replace(re, to); }
  return page;
}

// --- the commands: each takes ctx {io, dir, log, stdin} and its words, and answers an exit code ---
const plain = (what, v) => { if (typeof v === "string" && v.startsWith("-") && v !== "-") throw new Error(`a ${what} can't start with "-"`); return v; };
const spaceFile = (dir) => path.join(dir, ".docs", "space");
const spaceOf = (ctx) => { try { return fs.readFileSync(spaceFile(ctx.dir), "utf8").trim(); } catch { return ""; } };
// A page someone wrote that isn't a document from this skill: more than a few words, and no ledger.
const foreign = (html) => !ledgerOf(html) && words(html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")).length > 200;
const isConflict = (e) => e && (e.code === "conflict" || /conflict/i.test(String(e.message)));

function describe(html, only) {
  const L = ledgerOf(html) || { blocks: {}, sections: 0 };
  const root = parse(html), out = [];
  for (let n = 0; n <= L.sections; n++) {
    if (only !== undefined && n !== only) continue;
    const v = sectionView(html, root, L, n);
    if (!v) { out.push(`section ${n}: gone (the person removed or changed its frame)`); continue; }
    const head = byId(root, `d-s${n}-h`);
    out.push(`section ${n}${head ? ": " + words(inner(html, head)) : " (the opening)"}`);
    for (const c of v.body) out.push(`  ${(c.id || "(no id)").padEnd(10)} ${v.mineOf(c) ? "yours " : "person"}  ${words(inner(html, c)).slice(0, 100)}`);
  }
  return out;
}

const COMMANDS = {
  // The space, a status on it at once, and what it holds. Nothing is decided yet, so it runs before any thinking.
  start(ctx, args) {
    const fresh = args[0] === "--new";
    const link = fresh ? null : plain("link", args[0]), title = fresh ? plain("title", args[1]) : null;
    if (!fresh && !link) throw new Error("start: give the space's link; or --new \"<title>\" for a new space");
    if (fresh && !title) throw new Error("start --new: give the document's title");
    let id = spaceOf(ctx);
    if (fresh) {
      if (id) throw new Error("start --new: this folder has a space already; use another folder");
      id = ctx.io.create(title);
    } else {
      // The link as given: every call takes it, so the status goes up before anything else is asked.
      if (id && id !== link) throw new Error(`start: this folder is for space ${id}; use another folder for ${link}`);
      id = link;
    }
    ctx.space = id;
    ctx.io.push({ status: "Starting the document" });
    fs.mkdirSync(path.dirname(spaceFile(ctx.dir)), { recursive: true });
    fs.writeFileSync(spaceFile(ctx.dir), id);
    const html = ctx.io.read().files["index.html"] || "";
    if (ledgerOf(html)) {
      ctx.log("This space holds a document. Its blocks, and whose each one is:");
      for (const l of describe(html)) ctx.log(l);
      ctx.log("\n" + fs.readFileSync(WRITING, "utf8"));
      return 0;
    }
    if (foreign(html)) {
      ctx.io.push({ status: "Stopped: this space holds another page", stopped: true });
      throw new Error("start: this space holds a page that isn't a document from this skill, and it's never written over. Ask the person, or start --new");
    }
    ctx.log("\n" + fs.readFileSync(OUTLINE, "utf8"));
    return 0;
  },

  // The title and every heading, each section saying "Writing…", on open tabs and saved.
  outline(ctx, args) {
    let pages = null;
    const i = args.indexOf("--pages");
    if (i >= 0) { pages = +args[i + 1]; args = args.slice(0, i).concat(args.slice(i + 2)); if (!(pages >= 1)) throw new Error("--pages takes a number: the length the person asked for"); }
    const title = plain("title", args[0]), headings = args.slice(1).map((h) => plain("heading", h));
    if (!title || !headings.length) throw new Error("outline: give the title, then every heading");
    const r = ctx.io.read(), html = r.files["index.html"] || "";
    if (ledgerOf(html)) throw new Error("outline: this space has its outline already. Write its sections; for another document, start --new in a new folder");
    if (foreign(html)) throw new Error("outline: this space holds a page that isn't a document from this skill, and it's never written over");
    const page = buildPage(fs.readFileSync(STARTER, "utf8"), title, headings, pages);
    const a = ctx.io.push({ html: page });
    ctx.io.save({ parent: r.version, label: "Outline", files: [{ path: "index.html", content: page }] });
    ctx.log(`the title and ${headings.length} headings are on the page${a && a.tabs_open !== undefined ? ` (${a.tabs_open} tab${a.tabs_open === 1 ? "" : "s"} open)` : ""}, and saved`);
    ctx.log("\n" + fs.readFileSync(WRITING, "utf8"));
    return 0;
  },

  write(ctx, args) {
    const n = Number(args[0]);
    if (!Number.isInteger(n) || n < 0) throw new Error("write: give the section's number (0 is the opening), then a file or - for stdin");
    const src = args[1];
    if (!src) throw new Error("write: give a file with the section's text, or - to read it from stdin");
    const text = src === "-" ? ctx.stdin() : fs.readFileSync(path.resolve(ctx.dir, src), "utf8");
    const status = plain("status", args[2]);
    let shown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = ctx.io.read(), html = r.files["index.html"] || "";
      const p = planWrite(html, n, text);
      if (p.kept.length) ctx.log(`the person changed ${p.kept.join(", ")}: theirs now, left as they wrote it. Your words went around them; to change theirs, propose`);
      // A retry after a clash: blocks shown on open tabs that are the person's now get their words back.
      if (shown) {
        const root = parse(html), L = ledgerOf(html), fix = [];
        for (const e of shown) {
          const el = e.op === "replace" && byId(root, e.anchor);
          if (el && !(L.blocks[e.anchor] && sig(html, el) === L.blocks[e.anchor])) fix.push({ anchor: e.anchor, op: "replace", html: outer(html, el) });
        }
        if (fix.length) { ctx.io.push({ edits: fix }); ctx.log(`a person changed ${fix.map((f) => f.anchor).join(", ")} while you wrote: their words are back on screen and kept`); }
      }
      if (!p.changed && !p.kept.length) { if (status) ctx.io.push({ status }); ctx.log(`section ${n}: nothing changed`); return 0; }
      const body = Object.assign({ edits: p.edits }, status ? { status: status.slice(0, 200) } : {});
      if (p.edits.length) { const a = ctx.io.push(body); shown = p.edits; if (a && a.tabs_open !== undefined) ctx.log(`shown on ${a.tabs_open} open tab${a.tabs_open === 1 ? "" : "s"}`); }
      else if (status) ctx.io.push({ status });
      try {
        ctx.io.save({ parent: r.version, label: `Section ${n}`, replacements: p.replacements, live_patch: p.edits });
        ctx.log(`section ${n}: ${p.edits.length} change${p.edits.length === 1 ? "" : "s"}, saved`);
        return 0;
      } catch (e) {
        if (!isConflict(e)) throw e;
        ctx.log(`section ${n}: a person changed the page while you wrote; reading it again`);
      }
    }
    throw new Error(`write: section ${n} kept changing under you; run blocks ${n} and write it again`);
  },

  blocks(ctx, args) {
    const only = args[0] === undefined ? undefined : Number(args[0]);
    for (const l of describe(ctx.io.read().files["index.html"] || "", only)) ctx.log(l);
    return 0;
  },

  done(ctx) {
    const html = ctx.io.read().files["index.html"] || "", L = ledgerOf(html);
    if (!L) throw new Error("done: this space holds no document from this skill");
    const root = parse(html), left = [];
    for (let n = 0; n <= L.sections; n++) {
      const v = sectionView(html, root, L, n);
      if (v && v.mine.some((c) => words(inner(html, c)) === PLACEHOLDER)) left.push(n);
    }
    if (left.length) { ctx.log(`not done: section${left.length > 1 ? "s" : ""} ${left.join(", ")} still say "${PLACEHOLDER}". Write ${left.length > 1 ? "them" : "it"}, then done again`); return 1; }
    // The length the person asked for, as the page prints: over it is not done.
    if (L.pages) {
      ctx.io.push({ status: "Checking the printed length" });
      const n = ctx.io.pdfPages();
      if (n > L.pages) {
        ctx.io.push({ status: `Shortening: ${n} pages, ${L.pages} asked for` });
        ctx.log(`not done: it prints on ${n} A4 pages, and the person asked for ${L.pages}. Shorten it: cut what repeats, then each section to what the reader needs, and write those sections again. Then done again`);
        return 1;
      }
      ctx.log(`it prints on ${n} A4 page${n === 1 ? "" : "s"}, as asked`);
    }
    ctx.io.push({ status: "Ready to read" });
    const blanks = [...new Set((words(inner(html, byId(root, "d-doc") || root)).match(/\[[^\]]{1,80}\]/g) || []))];
    ctx.log(blanks.length ? `ready. Name these blanks in your reply, for the person to fill in: ${blanks.join(", ")}` : "ready.");
    return 0;
  },
};

function run(ctx, argv) {
  const [cmd, ...args] = argv;
  const f = COMMANDS[cmd];
  if (!f) { ctx.log(`docs.js: unknown command ${cmd || "(none)"}: ${Object.keys(COMMANDS).join(", ")}`); return 2; }
  if (cmd !== "start" && !ctx.space) ctx.space = spaceOf(ctx);
  if (cmd !== "start" && !ctx.space) { ctx.log(`docs.js: ${cmd}: no space yet; run start first, in this folder`); return 2; }
  try { return f(ctx, args); } catch (e) { ctx.log(`docs.js: ${e.message}`); return 1; }
}

module.exports = { COMMANDS, run, parse, planWrite, buildPage, blocksFromText, ledgerOf, describe, sig, norm, words, esc, PLACEHOLDER };
if (require.main !== module) return;

// --- the real space, through the spacesheep CLI ---
const argv = process.argv.slice(2);
if (argv[0] !== "-C" || !argv[1]) { console.error("docs.js: start with -C <folder>: node docs.js -C <folder> <start|write|blocks|done>"); process.exit(2); }
const DIR = path.resolve(argv[1]);
fs.mkdirSync(DIR, { recursive: true });
let cli = ["npx", "-y", "spacesheep@latest"];
try { const bin = execSync("command -v spacesheep", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 }).trim(); if (bin) cli = [bin]; } catch {}
const t0 = Date.now(), took = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
const sh = (args, input) => execFileSync(cli[0], [...cli.slice(1), ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], timeout: 90000, killSignal: "SIGKILL", maxBuffer: 64 << 20 });
const json = (out) => JSON.parse(out.slice(out.indexOf("{")));
const call = (tool, body) => {
  try { return json(sh(["call", tool, "-"], JSON.stringify(body))); }
  catch (e) {
    const msg = String(e.stderr || e.message || "");
    const err = new Error(`${tool}: ${msg.trim().split("\n").slice(-6).join(" ").slice(0, 400)}`);
    if (/"code":\s*"conflict"|\bconflict\b/.test(msg)) err.code = "conflict";
    throw err;
  }
};
// A space by its id, or by the link or @handle/slug the person gave: every call takes either.
const where = () => (UUID.test(ctx.space) ? { space_id: ctx.space } : { space: ctx.space });
const ctx = { dir: DIR, log: (l) => console.log(l), stdin: () => fs.readFileSync(0, "utf8") };
ctx.io = {
  create(title) {
    const w = path.join(DIR, ".docs", "new"); fs.mkdirSync(w, { recursive: true });
    fs.writeFileSync(path.join(w, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head><body></body></html>\n`);
    const j = json(sh(["deploy", w, "--title", title, "--emoji", "📄", "--json"]));
    const id = (j.space || j).uuid || (j.space || j).id;
    console.log(`made a new space: ${(j.space || j).url || id}`);
    return id;
  },
  read() { const j = call("get_file", Object.assign(where(), { file: "index.html" })); return { version: j.version.id, files: { "index.html": j.file.content } }; },
  push(body) { return call("push_live", Object.assign(where(), body)); },
  // The saved version as it prints on A4, counted from the PDF's page tree.
  pdfPages() {
    const url = call("export_space", Object.assign(where(), { paper: "a4" })).url;
    const pdf = execFileSync("curl", ["-sfL", "--max-time", "90", url], { maxBuffer: 64 << 20, timeout: 100000 });
    const counts = [...pdf.toString("latin1").matchAll(/\/Count\s+(\d+)/g)].map((m) => +m[1]);
    if (!counts.length) throw new Error("the PDF's page count couldn't be read");
    return Math.max(...counts);
  },
  save(body) { const j = call("create_version", Object.assign(where(), { client: { name: "docs-skill" } }, body)); return { version: j.version && j.version.id }; },
};
const code = run(ctx, argv.slice(2));
if (argv[2] !== "blocks") console.log(`(${took()})`);
process.exit(code);
