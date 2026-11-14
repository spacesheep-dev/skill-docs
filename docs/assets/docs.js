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
//   node docs.js -C <folder> done          checks nothing still says "Writing…", the length and the blanks. When
//                                          they pass, its save ends the run: open tabs say "Done", once.
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
const BLANK_LIVE_LINK = path.join(__dirname, "blank-live-link.html"), BLANK_LIVE_LINK_NODESC = path.join(__dirname, "blank-live-link-nodesc.html");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER = "Writing…";
const WORDS_FAR = 600; // words no A4 page of the starter holds

// --- reading a page: elements, their ids, their spans (pure) ---
const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
// Elements whose insides are text, never elements: a section pasted into a textarea is words in a box.
const RAW = new Set("script style textarea title xmp iframe noembed noframes noscript plaintext".split(" "));
const TAG = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const attr = (attrs, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs || ""); return m ? (m[2] !== undefined ? m[2] : m[3]) : null; };
// A tree of elements: {name, id, start, openEnd, closeStart, end, children}. Lenient: an unclosed element ends
// where its parent does; the insides of RAW elements are skipped whole.
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
      if (RAW.has(name)) {
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
// What a block holds, in one canonical form: its words (entities decoded, then escaped again, so markup typed as
// text stays text), and each inline tag with every attribute but data-ss-id, sorted. Spacing is collapsed. A link
// whose address changed, or words typed as "<strong>", read differently from what the tool wrote.
const escText = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function canonTag(close, name, attrs) {
  if (close) return `</${name.toLowerCase()}>`;
  const list = [];
  for (const m of String(attrs || "").matchAll(/([^\s=\/"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+))?/g)) {
    const k = m[1].toLowerCase();
    if (k === "data-ss-id") continue;
    const v = m[2] === undefined ? "" : decode(m[2].replace(/^["']|["']$/g, ""));
    list.push(`${k}="${escText(v).replace(/"/g, "&quot;")}"`);
  }
  return `<${name.toLowerCase()}${list.sort().map((a) => " " + a).join("")}>`;
}
function norm(s) {
  let out = "", last = 0;
  for (const m of String(s).matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    out += escText(decode(s.slice(last, m.index))) + canonTag(m[1], m[2], m[3]);
    last = m.index + m[0].length;
  }
  return (out + escText(decode(s.slice(last)))).replace(/\s+/g, " ").trim();
}
const words = (s) => decode(s.replace(/<br\s*\/?>|<\/(?:li|p|h\d|blockquote)>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const sig = (html, el) => crypto.createHash("sha256").update(el.name + ":" + norm(inner(html, el))).digest("hex").slice(0, 16);

// --- text in, markup out: every character escaped first, then only these few marks become tags ---
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// A change to the words between tags only: a link's address, or any other attribute, is never touched.
const onText = (h, fn) => h.split(/(<[^>]*>)/).map((part, i) => (i % 2 ? part : fn(part))).join("");
function inline(s) {
  let h = esc(s);
  h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (m, t, u) => `<a href="${u}">${t}</a>`);
  h = onText(h, (t) => t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>"));
  // A blank, [what to fill in], is marked so the page can show it and Tab can reach it; print shows plain brackets.
  h = onText(h, (t) => t.replace(/(^|[^\w])(\[[^\[\]<>\n]{1,80}\])(?!\()/g, '$1<mark class="blank" tabindex="0">$2</mark>'));
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
// The ledger is the one <meta name="docs-ledger"> the parsed page holds, outside comments and raw text, and its
// source appears once (so a save can name it exactly). Anything else, a copy in a comment included, is no ledger.
function ledgerMeta(html) {
  const metas = [];
  walk(parse(html), (e) => { if (e.name === "meta" && /\bname\s*=\s*"docs-ledger"/.test(html.slice(e.start, e.openEnd))) metas.push(e); });
  if (metas.length !== 1) return null;
  const tag = outer(html, metas[0]);
  return html.split(tag).length === 2 ? tag : null;
}
const LEDGER = { exec: (html) => { const t = ledgerMeta(html); return t ? [t] : null; } };
function ledgerOf(html) { const t = ledgerMeta(html), m = t && /content="([^"]*)"/.exec(t); if (!m) return null; try { return JSON.parse(decode(m[1])); } catch { return null; } }
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
// The sections still saying "Writing…": one of the tool's blocks in them has no words yet.
function unwritten(html) {
  const L = ledgerOf(html), left = [];
  if (!L) return left;
  const root = parse(html);
  for (let n = 0; n <= L.sections; n++) {
    const v = sectionView(html, root, L, n);
    if (v && v.mine.some((c) => words(inner(html, c)) === "")) left.push(n);
  }
  return left;
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

// One block from text: the first block of the text takes its place and its id, the rest go right after it, and
// empty text removes it. mine: the block must be the tool's. sigWas: the block must still read as it did then
// (a proposal the person said yes to); it stays theirs after.
function planBlock(html, id, text, { mine, sigWas }) {
  const L = ledgerOf(html);
  if (!L) throw new Error("this page has no ledger: it isn't a document from this skill");
  const root = parse(html), el = byId(root, id);
  if (!el) throw new Error(`no block ${id}, or it appears twice: run blocks`);
  const sec = el.parent;
  const m = sec && sec.id && /^d-s(\d+)$/.exec(sec.id);
  if (!m || byId(root, sec.id) !== sec || id === `${sec.id}-h`) throw new Error(`${id} isn't a block in one of the document's sections`);
  const key = sec.id, NL = JSON.parse(JSON.stringify(L));
  NL.next[key] = NL.next[key] || 1;
  if (mine && !(L.blocks[id] && sig(html, el) === L.blocks[id] && idCounts(root)[id] === 1)) throw new Error(`${id} is the person's: propose the change instead`);
  if (sigWas && sig(html, el) !== sigWas) throw new Error(`${id} changed since you proposed: read it with blocks, and propose again`);
  const news = blocksFromText(text), edits = [];
  let rep;
  if (!news.length) {
    let end = el.end; if (html[end] === "\n") end++;
    rep = [el.start, end, ""]; edits.push({ anchor: id, op: "remove" }); delete NL.blocks[id];
  } else {
    const first = render(news[0], id), rest = news.slice(1).map((b) => { const nid = `${key}-${NL.next[key]++}`; if (mine) NL.blocks[nid] = blockSig(b); return render(b, nid); });
    if (mine) NL.blocks[id] = blockSig(news[0]);
    rep = [el.start, el.end, [first, ...rest].join("\n")];
    edits.push({ anchor: id, op: "replace", html: first });
    if (rest.length) edits.push({ anchor: id, op: "insert_after", html: rest.join("\n") });
  }
  const secOld = outer(html, sec), secNew = secOld.slice(0, rep[0] - sec.start) + rep[2] + secOld.slice(rep[1] - sec.start);
  return { edits, replacements: [{ old_string: secOld, new_string: secNew }, { old_string: LEDGER.exec(html)[0], new_string: ledgerTag(NL) }], kept: [], ledger: NL };
}

// The starter with this document's title and headings, each with a placeholder.
function buildPage(starter, title, headings, pages) {
  const L = { v: 1, sections: headings.length, pages: pages || null, next: {}, blocks: {} };
  // A placeholder holds no words: the page draws "Writing…" in it only while it's empty, so words a person types
  // into it look like their words, with nothing of the tool's to take off.
  const ph = { tag: "p", html: "" };
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
// A page that isn't a document from this skill: no ledger, and anything at all in its body. A short note, an image,
// a table, an embed: each is the person's. Only an empty body is blank.
// Blank is a short closed list of whole pages, compared after dropping whitespace: an empty file, this skill's
// starter before any outline, and staging's "working on it" page (live_link, saved 14 Nov 2026) in its two forms,
// with a description line and without, whose title and description are plain-text slots. Everything else is the person's page, however empty it looks: a wrong "not
// blank" costs one question; a wrong "blank" deletes someone's work.
const flat = (t) => String(t).replace(/\s+/g, "");
// Each slot is text only and stays where it is, in its exact tag; nothing is taken out before the comparison.
function liveLinkSlots(html) {
  let n = 0;
  const one = (re, to) => { html = html.replace(re, (...m) => { n++; return to(...m); }); };
  one(/<title>[^<]*<\/title>/, () => "<title>T</title>");
  one(/(<meta name="description" content="Spacesheep is working on it: )[^"<]*(">)/, (m, a, b) => a + "D" + b);
  one(/(<p class="ll-what" data-ss-id="what" data-ss-react="off">)[^<]*(<\/p>)/, (m, a, b) => a + "T" + b);
  html = html.replace(/(<p class="ll-desc" data-ss-id="desc" data-ss-react="off">)[^<]*(<\/p>)/, (m, a, b) => a + "D" + b);
  return n === 3 ? html : null;
}
let BLANKS = null;
function blank(html) {
  BLANKS = BLANKS || [STARTER, BLANK_LIVE_LINK, BLANK_LIVE_LINK_NODESC].map((f) => flat(fs.readFileSync(f, "utf8")));
  const h = flat(html), slotted = liveLinkSlots(String(html)), sf = slotted === null ? null : flat(slotted);
  return h === "" || h === BLANKS[0] || sf === BLANKS[1] || sf === BLANKS[2];
}
const foreign = (html) => !ledgerOf(html) && !blank(html);
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
    for (const c of v.body) out.push(`  ${(c.id || "(no id)").padEnd(10)} ${v.mineOf(c) ? "yours " : "person"}  ${words(inner(html, c)).slice(0, 100) || "(" + PLACEHOLDER + ")"}`);
  }
  return out;
}

// Text for a block or a section: a file in the folder, or - for stdin.
function textArg(ctx, src, cmd) {
  if (!src) throw new Error(`${cmd}: give a file with the text, or - to read it from stdin`);
  return src === "-" ? ctx.stdin() : fs.readFileSync(path.resolve(ctx.dir, src), "utf8");
}
// Comments the tool writes carry this, so its own are told from the person's (both post as the person's account).
const AGENT = "Agent: ";
const byAgent = (c) => String(c.body || "").startsWith(AGENT);
// A yes is a whole reply from this short list, after lower-casing and dropping punctuation. Anything longer or
// different isn't one, however it starts: "Yes, if you leave the price" is a condition, for a new proposal.
const YES = new Set(["yes", "y", "yep", "yeah", "yes please", "please do", "yes go ahead", "yes do it", "ok", "okay", "ok go ahead",
  "sure", "go ahead", "do it", "go for it", "approved", "agreed", "accepted", "accept", "\u{1F44D}", "\u2705", "\u{1F44C}"]);
const isYes = (t) => YES.has(words(String(t || "")).toLowerCase().replace(/[.,!]+/g, " ").replace(/\s+/g, " ").trim());
function findComment(ctx, ref) {
  if (!ref) throw new Error("give the comment's id: comments lists them");
  const hits = ctx.io.comments().filter((c) => !c.reply_to && c.id.startsWith(ref));
  if (hits.length !== 1) throw new Error(`no single open comment starts with ${ref}: comments lists them`);
  return hits[0];
}
// The one place a change to the person's words is asked for, shaped as the platform's suggestions will take it
// (create_suggestion { space, changes: [{block, before, after}] (1 to 20), reason }: one suggestion, its changes
// accepted together), refused as a conflict when a block no longer reads `before`. Today it is one comment pinned
// to the first change's block, quoting it; when pages have suggestions, only this function changes. Answers the
// one id it made.
function propose(ctx, html, { changes, reason }) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 20) throw new Error("propose: 1 to 20 changes");
  const root = parse(html);
  for (const c of changes) {
    const el = byId(root, c.block);
    if (!el || words(inner(html, el)) !== words(esc(c.before))) {
      const e = new Error(`conflict: ${c.block} doesn't read as it did when you proposed: read it with blocks, and propose again`);
      e.code = "conflict";
      throw e;
    }
  }
  const quoteAfter = (t) => String(t).trim().split("\n").map((l) => "> " + l).join("\n");
  const what = changes.length === 1 ? `I'd change this to:\n\n${quoteAfter(changes[0].after)}`
    : `I'd change these together:\n\n${changes.map((c) => `In ${c.block}, "${words(esc(c.before)).slice(0, 80)}" to:\n\n${quoteAfter(c.after)}`).join("\n\n")}`;
  const body = `${AGENT}${what}\n\n${reason ? reason.trim() + "\n\n" : ""}Reply yes to make ${changes.length === 1 ? "the change" : "them all"}, or say what you'd rather.`;
  return ctx.io.comment({ block: changes[0].block, quote: String(changes[0].before).slice(0, 2000), body }).id;
}

// After a save: open tabs wait 5 s for a status, then say "Done" and take the work card down. The run ends on
// done's save, once it has checked the page, so until then a status goes back up after every save: the
// section's next status while one still says "Writing…", then "Checking the page". Once done has checked the
// page, a save is the end of its own change, and nothing goes after it.
const CHECKING = "Checking the page";
function afterSave(ctx, saved, status) {
  const L = ledgerOf(saved);
  if (!L) return;
  if (unwritten(saved).length) { if (status) ctx.io.push({ status: status.slice(0, 200) }); return; }
  if (L.checked) return;
  ctx.io.push({ status: (status || CHECKING).slice(0, 200) });
  ctx.log("every section is written. Run done next: its save ends the run, and open tabs say Done then");
}

// done's save, the run's last: the ledger records that the page passed its checks. It names the page from the
// ledger to its end as done read it, so it saves only onto the version done checked: a change since, even one
// landing during the save, makes it a conflict, and done checks the page again. Its live change leaves the page
// as it is (one word of the page for itself), so open tabs patch instead of reloading, and say "Done". Answers
// false on a conflict.
function closeRun(ctx, r, html, L) {
  const tag = LEDGER.exec(html)[0], from = html.indexOf(tag), span = html.slice(from);
  const NL = Object.assign({}, L, { checked: true });
  const live = noopPatch(html, parse(html), L);
  try {
    ctx.io.save(Object.assign({ parent: r.version, label: "Checked", replacements: [{ old_string: span, new_string: ledgerTag(NL) + span.slice(tag.length) }] }, live ? { live_patch: [live] } : {}));
    return true;
  } catch (e) { if (!isConflict(e)) throw e; return false; }
}

// A live change that changes nothing: one word of the title, or of the first block that has one, swapped for
// itself. A word is a run of anything but spaces and what a tab writes back escaped (& < > and no-break
// spaces), so a title in any script, or only an emoji, has one.
function noopPatch(html, root, L) {
  for (const id of ["d-title", ...Object.keys(L.blocks || {})]) {
    const el = byId(root, id);
    const w = el && /[^\s&<>"'\u00a0]+/u.exec(inner(html, el).replace(/<[^>]*>|&[^;\s]*;/g, " "));
    if (w) return { anchor: id, op: "sub", old: w[0], html: w[0] };
  }
  return null;
}

// Read, plan, show, save: the one path every change takes. A clash (someone changed the page since the read)
// puts the saved words back on screen where this showed others, and plans again from a new read.
function commit(ctx, what, status, plan) {
  let shown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = ctx.io.read(), html = r.files["index.html"] || "";
    let p = null, failed = null;
    try { p = plan(html); } catch (e) { failed = e; }
    if (shown) repair(ctx, html, shown, p ? p.edits : []);
    if (failed) throw failed;
    if (p.kept && p.kept.length) ctx.log(`the person changed ${p.kept.join(", ")}: theirs now, left as they wrote it. Your words went around them; to change theirs, propose`);
    if (!p.edits.length && !(p.kept && p.kept.length)) { if (status && unwritten(html).length) ctx.io.push({ status }); ctx.log(`${what}: nothing changed`); return; }
    if (p.edits.length) {
      const a = ctx.io.push(Object.assign({ edits: p.edits }, status ? { status: status.slice(0, 200) } : {}));
      shown = p.edits;
      if (a && a.tabs_open !== undefined) ctx.log(`shown on ${a.tabs_open} open tab${a.tabs_open === 1 ? "" : "s"}`);
    }
    try {
      ctx.io.save({ parent: r.version, label: what[0].toUpperCase() + what.slice(1), replacements: p.replacements, live_patch: p.edits });
    } catch (e) {
      if (!isConflict(e)) throw e;
      ctx.log(`${what}: the page changed while you wrote; reading it again`);
      continue;
    }
    ctx.log(`${what}: ${p.edits.length} change${p.edits.length === 1 ? "" : "s"}, saved`);
    afterSave(ctx, p.replacements.reduce((h, x) => h.replace(x.old_string, () => x.new_string), html), status);
    return;
  }
  throw new Error(`${what} kept changing under you; run blocks and try again`);
}
// After a clash, open tabs show what was pushed but not saved. Put the saved page back there, block by block,
// except where the new plan changes that block again anyway: words put back, blocks removed on screen but kept
// in the save put back in their place, blocks added on screen but not saved taken off.
function repair(ctx, html, shown, next) {
  const root = parse(html), counts = idCounts(root), fix = [];
  const again = new Set(next.filter((e) => e.op === "replace" || e.op === "remove").map((e) => e.anchor));
  // What open tabs lack now: blocks the shown edits removed. One put back below is on screen again.
  const offScreen = new Set(shown.filter((e) => e.op === "remove").map((e) => e.anchor));
  const unique = (el) => el && el.id && counts[el.id] === 1 && !offScreen.has(el.id);
  for (const e of shown) {
    if (e.op === "replace") {
      const el = byId(root, e.anchor);
      if (el && outer(html, el) !== e.html && !again.has(e.anchor)) fix.push({ anchor: e.anchor, op: "replace", html: outer(html, el) });
    } else if (e.op === "remove") {
      const el = byId(root, e.anchor);
      if (!el || again.has(e.anchor)) continue;
      const sib = el.parent.children, i = sib.indexOf(el);
      const prev = sib.slice(0, i).reverse().find(unique), nextEl = sib.slice(i + 1).find(unique);
      if (prev) fix.push({ anchor: prev.id, op: "insert_after", html: outer(html, el) });
      else if (nextEl) fix.push({ anchor: nextEl.id, op: "insert_before", html: outer(html, el) });
      else if (unique(el.parent)) fix.push({ anchor: el.parent.id, op: "append_into", html: outer(html, el) });
      else continue;
      offScreen.delete(el.id);
    } else if (e.op === "append_into" || e.op === "insert_after") {
      for (const m of e.html.matchAll(/data-ss-id="([^"]+)"/g)) if (!byId(root, m[1])) fix.push({ anchor: m[1], op: "remove" });
    }
  }
  if (fix.length) { ctx.io.push({ edits: fix }); ctx.log(`someone changed the page while you wrote: open tabs show the saved words again (${fix.length} block${fix.length === 1 ? "" : "s"})`); }
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
      throw new Error("start: this space holds a page someone made, and it's never written over. Nothing changed. Ask the person: use a new page (start --new, in a new folder), or tell you what to do with theirs");
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
    if (foreign(html)) throw new Error("outline: this space holds a page someone made, and it's never written over. Nothing changed. Ask the person: use a new page (start --new, in a new folder), or tell you what to do with theirs");
    const page = buildPage(fs.readFileSync(STARTER, "utf8"), title, headings, pages);
    const a = ctx.io.push({ html: page });
    ctx.io.save({ parent: r.version, label: "Outline", files: [{ path: "index.html", content: page }] });
    ctx.io.push({ status: "Writing the opening" }); // a save takes the work card down: the work isn't done
    ctx.log(`the title and ${headings.length} headings are on the page${a && a.tabs_open !== undefined ? ` (${a.tabs_open} tab${a.tabs_open === 1 ? "" : "s"} open)` : ""}, and saved`);
    ctx.log("\n" + fs.readFileSync(WRITING, "utf8"));
    return 0;
  },

  write(ctx, args) {
    const n = Number(args[0]);
    if (!Number.isInteger(n) || n < 0) throw new Error("write: give the section's number (0 is the opening), then a file or - for stdin");
    const text = textArg(ctx, args[1], "write");
    commit(ctx, `section ${n}`, plain("status", args[2]), (html) => planWrite(html, n, text));
    return 0;
  },

  // One block of yours, changed from text: a comment's ask, a fix. The person's blocks are refused: propose.
  edit(ctx, args) {
    const id = plain("block", args[0]);
    if (!id) throw new Error("edit: give the block's id (blocks lists them), then a file or - for stdin");
    const text = textArg(ctx, args[1], "edit");
    commit(ctx, id, plain("status", args[2]), (html) => planBlock(html, id, text, { mine: true }));
    return 0;
  },

  // The open comment threads: on whose block, what they ask, the replies, and your proposals waiting.
  comments(ctx) {
    const html = ctx.io.read().files["index.html"] || "", L = ledgerOf(html) || { blocks: {}, proposals: {} };
    const all = ctx.io.comments(), root = parse(html), counts = idCounts(root);
    const top = all.filter((c) => !c.reply_to && !c.resolved);
    if (!top.length) { ctx.log("no open comments"); return 0; }
    for (const c of top) {
      const el = c.block ? byId(root, c.block) : null;
      const whose = !c.block ? "the whole page" : !el ? `${c.block}, gone` : (L.blocks[c.block] && counts[c.block] === 1 && sig(html, el) === L.blocks[c.block]) ? `${c.block}, yours` : `${c.block}, the person's`;
      const prop = (L.proposals || {})[c.id];
      ctx.log(`${c.id.slice(0, 8)}  ${prop ? "your proposal" : "comment"} on ${whose}${c.quote ? `, quoting "${words(c.quote).slice(0, 80)}"` : ""}`);
      ctx.log(`          ${byAgent(c) ? "you" : "they"}: ${words(c.body).slice(0, 300)}`);
      for (const r of all.filter((x) => x.reply_to && x.reply_to.id === c.id)) ctx.log(`          ${byAgent(r) ? "you" : "they"}: ${words(r.body).slice(0, 300)}`);
    }
    return 0;
  },

  // A reply in a comment's thread, from you; --resolve closes the thread once its ask is done.
  reply(ctx, args) {
    const resolve = args.includes("--resolve"), rest = args.filter((a) => a !== "--resolve");
    const c = findComment(ctx, rest[0]);
    const text = rest[1] === "-" ? ctx.stdin() : rest[1];
    if (!text || !String(text).trim()) throw new Error("reply: give the comment, then the reply's words");
    ctx.io.comment({ reply_to: c.id, body: AGENT + String(text).trim() });
    if (resolve) ctx.io.resolve(c.id);
    ctx.log(`replied${resolve ? " and resolved" : ""}`);
    return 0;
  },

  // A change to the person's words, asked for: a comment pinned to their block, quoting it. Nothing changes yet.
  propose(ctx, args) {
    const id = plain("block", args[0]);
    if (!id) throw new Error("propose: give the person's block id, then a file or - for stdin with the words you'd put there, then why, in a few words");
    const text = textArg(ctx, args[1], "propose"), reason = plain("reason", args[2]);
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = ctx.io.read(), html = r.files["index.html"] || "", L = ledgerOf(html);
      if (!L) throw new Error("propose: this space holds no document from this skill");
      const root = parse(html), el = byId(root, id);
      if (!el) throw new Error(`propose: no block ${id}, or it appears twice: run blocks`);
      if (L.blocks[id] && sig(html, el) === L.blocks[id] && idCounts(root)[id] === 1) throw new Error(`propose: ${id} is yours, not the person's: change it with edit`);
      if (!blocksFromText(text).length) throw new Error("propose: give the words you'd put in its place");
      const cid = propose(ctx, html, { changes: [{ block: id, before: words(inner(html, el)), after: text }], reason: reason || "" });
      const NL = JSON.parse(JSON.stringify(L));
      NL.proposals = NL.proposals || {};
      NL.proposals[cid] = { changes: [{ block: id, sig: sig(html, el), text: String(text) }] };
      try {
        ctx.io.save({ parent: r.version, label: `Proposal on ${id}`, replacements: [{ old_string: LEDGER.exec(html)[0], new_string: ledgerTag(NL) }] });
        afterSave(ctx, html.replace(LEDGER.exec(html)[0], () => ledgerTag(NL)), null);
        ctx.log(`proposed on ${id}: comment ${cid.slice(0, 8)}. Nothing changes until the person answers yes there; then apply ${cid.slice(0, 8)}`);
        return 0;
      } catch (e) { if (!isConflict(e)) throw e; ctx.io.resolve(cid); }
    }
    throw new Error("propose: the page kept changing; run blocks and propose again");
  },

  // A proposal the person said yes to, made: only if their block still reads as it did when you proposed.
  apply(ctx, args) {
    const c = findComment(ctx, args[0]);
    const replies = ctx.io.comments().filter((x) => x.reply_to && x.reply_to.id === c.id && !byAgent(x));
    const first = ledgerOf(ctx.io.read().files["index.html"] || ""), P = first && (first.proposals || {})[c.id];
    if (!P) throw new Error(`apply: ${c.id.slice(0, 8)} isn't one of your proposals`);
    if (!replies.length) throw new Error(`apply: the person hasn't answered ${c.id.slice(0, 8)} yet. Wait for their yes`);
    const last = replies[replies.length - 1];
    if (!isYes(last.body)) throw new Error(`apply: their last reply isn't a plain yes, so nothing changed. Read it with comments. If it carries a condition, make a new proposal that keeps it, and wait for their yes there; if it's a no, reply and resolve; if it's a question, answer it`);
    // Its changes go together: each block must still read as it did when proposed, checked on one read first.
    commit(ctx, `the proposal ${c.id.slice(0, 8)}`, null, (html) => {
      const root = parse(html);
      for (const ch of P.changes) { const el = byId(root, ch.block); if (!el || sig(html, el) !== ch.sig) throw new Error(`${ch.block} changed since you proposed: read it with blocks, and propose again`); }
      return { edits: [], replacements: [], kept: [] };
    });
    P.changes.forEach((ch, i) => commit(ctx, `${ch.block}, as proposed`, null, (html) => {
      const p = planBlock(html, ch.block, ch.text, { sigWas: ch.sig });
      if (i === P.changes.length - 1) { delete p.ledger.proposals[c.id]; p.replacements[p.replacements.length - 1] = { old_string: LEDGER.exec(html)[0], new_string: ledgerTag(p.ledger) }; }
      return p;
    }));
    ctx.io.comment({ reply_to: c.id, body: AGENT + "Changed, as you said yes to." });
    ctx.io.resolve(c.id);
    ctx.log(`applied to ${P.changes.map((ch) => ch.block).join(", ")}, replied and resolved. ${P.changes.length === 1 ? "It stays" : "They stay"} the person's`);
    return 0;
  },

  blocks(ctx, args) {
    const only = args[0] === undefined ? undefined : Number(args[0]);
    for (const l of describe(ctx.io.read().files["index.html"] || "", only)) ctx.log(l);
    return 0;
  },

  // Checks the page as read, and saves "Checked" onto that same version; if it changed since, checks again.
  done(ctx) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = doneOnce(ctx);
      if (code !== null) return code;
      ctx.log("done: the page changed while you checked; checking it again");
    }
    throw new Error("done: the page kept changing; run done again");
  },
};

function doneOnce(ctx) {
  const r = ctx.io.read(), html = r.files["index.html"] || "", L = ledgerOf(html);
  if (!L) throw new Error("done: this space holds no document from this skill");
  const root = parse(html), left = unwritten(html);
  if (left.length) { ctx.log(`not done: section${left.length > 1 ? "s" : ""} ${left.join(", ")} still say "${PLACEHOLDER}". Write ${left.length > 1 ? "them" : "it"}, then done again`); return 1; }
  // The length the person asked for, as the page prints: over it is not done.
  if (L.pages) {
    // Far over (more words than any page of this starter prints, measured at 520 a page) is said at once;
    // anything nearer is printed and counted.
    const total = L.sections >= 0 ? [...Array(L.sections + 1).keys()].reduce((t, k) => { const v = sectionView(html, root, L, k); return t + (v ? v.body.reduce((a, c) => a + words(inner(html, c)).split(" ").filter(Boolean).length, 0) : 0); }, 0) : 0;
    const n = total > L.pages * WORDS_FAR ? Math.ceil(total / 450) : ctx.io.pdfPages();
    if (n > L.pages) {
      ctx.io.push({ status: `Shortening: ${n} pages, ${L.pages} asked for` });
      const per = [];
      for (let k = 0; k <= L.sections; k++) { const v = sectionView(html, root, L, k); if (v) per.push([k, v.body.reduce((t, c) => t + words(inner(html, c)).split(" ").filter(Boolean).length, 0)]); }
      const total = per.reduce((t, x) => t + x[1], 0), cut = Math.ceil(total - (total * L.pages) / n * 0.9);
      ctx.log(`not done: it prints on ${n} A4 pages, and the person asked for ${L.pages}. Cut about ${cut} of its ${total} words: what repeats first, then each section to what the reader needs. Write those sections again, then done again.`);
      ctx.log(`words by section: ${per.map(([k, w]) => `${k}: ${w}`).join(", ")}`);
      return 1;
    }
    ctx.log(`it prints on ${n} A4 page${n === 1 ? "" : "s"}, as asked`);
  }
  // The words of the tool's own blocks: each still holds what it wrote (its id once, its sig as the ledger has it).
  // Only these are checked and named below. Text the person typed is counted, never repeated, never a refusal.
  const doc = byId(root, "d-doc") || root, counts = idCounts(root), ownText = [];
  walk(doc, (e) => { if (e.id && L.blocks[e.id] && counts[e.id] === 1 && sig(html, e) === L.blocks[e.id]) ownText.push(words(inner(html, e))); });
  // A blank is one value to fill in. An alternative sentence inside one ("[or: with whoever else]") isn't. A
  // person's "[or …]" stays theirs: the agent can't rewrite their block, so it never stops done.
  const alt = [...new Set(ownText.flatMap((t) => t.match(/\[\s*or\b[^\]]{0,80}\]/gi) || []))];
  if (alt.length) { ctx.log(`not done: ${alt.join(", ")} ${alt.length === 1 ? "is an alternative" : "are alternatives"} inside a blank. A blank is one value to fill in: write it as one, like [alone, or with whom], then done again`); return 1; }
  const open = ctx.io.comments().filter((c) => !c.reply_to && !c.resolved && !(L.proposals || {})[c.id]);
  if (open.length) ctx.log(`${open.length} open comment${open.length === 1 ? "" : "s"} on the page: run comments, and answer them before you reply`);
  // Ready: the run ends on one save, and nothing goes after it, so open tabs say "Done" once. On a page done
  // has checked before, a card a status left up (start on a finished document) comes down with an empty
  // status instead.
  if (!L.checked) {
    if (!closeRun(ctx, r, html, L)) return null;
    ctx.log("checked and saved: open tabs say Done. Send nothing more to the page");
  } else if (cardUp(ctx)) ctx.io.push({ status: "" });
  // Blanks are named only from the tool's own blocks, whose words it wrote: text in square brackets that the
  // person typed is counted, never repeated, for the same reason as their blocks below.
  const BLANK = /\[[^\]]{1,80}\]/g, own = new Set(ownText.flatMap((t) => t.match(BLANK) || []));
  const all = [...new Set(words(inner(html, doc)).match(BLANK) || [])], blanks = all.filter((b) => own.has(b)), more = all.length - blanks.length;
  // The reply says where the person wrote on the page from these counts, never from a guess. Their words stay out
  // of this line: it is read as the next step, and anyone who can type on the page would be writing into it.
  const theirs = personBlocks(html, root, L), per = new Map();
  for (const b of theirs) per.set(b.section, (per.get(b.section) || 0) + 1);
  const where = [...per].sort((a, b) => (a[0] === null) - (b[0] === null) || a[0] - b[0])
    .map(([n, k]) => `${k} ${n === null ? "outside the sections" : "in section " + n}`).join(", ");
  const it = theirs.length === 1 ? "it" : "them";
  ctx.log(theirs.length
    ? `the person wrote ${theirs.length} block${theirs.length === 1 ? "" : "s"} on the page, left as they wrote ${it}: ${where}. Say so in your reply, by section; don't quote ${it}`
    : "no block in the document is the person's");
  ctx.log(["ready.", blanks.length ? `Name these blanks in your reply, for the person to fill in: ${blanks.join(", ")}.` : "",
    more === 1 ? "The person's own blocks hold 1 more piece of text in square brackets. It's theirs, not a blank of yours: mention it, don't quote it, don't call it a blank." :
    more ? `The person's own blocks hold ${more} more pieces of text in square brackets. They're theirs, not blanks of yours: mention them, don't quote them, don't call them blanks.` : ""].filter(Boolean).join(" "));
  return 0;
}

// The person's own blocks in the document, with words in them: one they typed in or added inside a section,
// and anything they put in it outside the sections. The title and the section headings aren't counted.
function personBlocks(html, root, L) {
  const doc = byId(root, "d-doc"), out = [];
  if (!doc) return out;
  for (const c of doc.children) {
    const m = /^d-s(\d+)$/.exec(c.id || ""), n = m ? Number(m[1]) : -1;
    const v = m && n <= L.sections ? sectionView(html, root, L, n) : null;
    if (v) { for (const b of v.body) if (!v.mineOf(b)) out.push({ section: n, id: b.id, text: words(inner(html, b)) }); }
    else if (c.id !== "d-title") out.push({ section: null, id: c.id, text: words(inner(html, c)) });
  }
  return out.filter((b) => b.text);
}

// The work card on open tabs: a status puts it up, and a save or an empty status takes it down. The folder keeps
// which came last, across commands, so done knows whether a card is still up.
const cardFile = (dir) => path.join(dir, ".docs", "card");
const cardUp = (ctx) => { try { return fs.readFileSync(cardFile(ctx.dir), "utf8").trim() === "up"; } catch { return false; } };
function watchCard(ctx) {
  const io = ctx.io, mark = (state) => { try { fs.mkdirSync(path.dirname(cardFile(ctx.dir)), { recursive: true }); fs.writeFileSync(cardFile(ctx.dir), state); } catch {} };
  ctx.io = Object.assign({}, io, {
    push(body) { const a = io.push(body); if (body.status !== undefined) mark(body.status ? "up" : "down"); return a; },
    save(body) { const v = io.save(body); mark("down"); return v; },
  });
}

function run(ctx, argv) {
  const [cmd, ...args] = argv;
  const f = COMMANDS[cmd];
  if (!f) { ctx.log(`docs.js: unknown command ${cmd || "(none)"}: ${Object.keys(COMMANDS).join(", ")}`); return 2; }
  watchCard(ctx);
  if (cmd !== "start" && !ctx.space) ctx.space = spaceOf(ctx);
  if (cmd !== "start" && !ctx.space) { ctx.log(`docs.js: ${cmd}: no space yet; run start first, in this folder`); return 2; }
  try { return f(ctx, args); } catch (e) { ctx.log(`docs.js: ${e.message}`); return 1; }
}

module.exports = { COMMANDS, run, parse, planWrite, planBlock, propose, isYes, buildPage, blocksFromText, ledgerOf, describe, sig, norm, words, esc, PLACEHOLDER };
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
    err.message += /no tab confirmed/.test(msg) && !/no tab confirmed/.test(err.message) ? " (no tab confirmed)" : "";
    throw err;
  }
};
// A space by its id, or by the link or @handle/slug the person gave: every call takes either.
const where = () => (UUID.test(ctx.space) ? { space_id: ctx.space } : { space: ctx.space });
const ctx = { dir: DIR, log: (l) => console.log(l), stdin: () => fs.readFileSync(0, "utf8") };
ctx.io = {
  create(title) {
    const w = path.join(DIR, ".docs", "new"); fs.mkdirSync(w, { recursive: true });
    fs.writeFileSync(path.join(w, "index.html"), fs.readFileSync(STARTER, "utf8")); // the starter: blank, by the list
    const j = json(sh(["deploy", w, "--title", title, "--emoji", "📄", "--json"]));
    const id = (j.space || j).uuid || (j.space || j).id;
    console.log(`made a new space: ${(j.space || j).url || id}`);
    return id;
  },
  read() { const j = call("get_file", Object.assign(where(), { file: "index.html" })); return { version: j.version.id, files: { "index.html": j.file.content } }; },
  // A push no open tab confirmed in time was still sent; the save that follows is what lasts, so it goes on.
  push(body) {
    try { return call("push_live", Object.assign(where(), body)); }
    catch (e) { if (/no tab confirmed|"code":\s*"unavailable"/.test(e.message)) { console.log("an open tab didn't confirm the push in time; saving it anyway"); return { unconfirmed: true }; } throw e; }
  },
  comments() {
    const out = [];
    let after = "";
    for (let i = 0; i < 20; i++) {
      const j = call("list_comments", Object.assign(where(), { limit: 200 }, after ? { after } : {}));
      out.push(...(j.comments || []));
      after = j.page && j.page.next;
      if (!after) break;
    }
    return out;
  },
  comment(body) { return call("create_comment", Object.assign(where(), body)).comment; },
  resolve(id) { return call("update_comment", Object.assign(where(), { comment: id, resolved: true })); },
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
