---
name: docs
description: Use when someone wants a document written on a page they and others will read, comment on and edit together, such as a proposal, a letter, a brief, a plan, a policy or a report. It writes the document live on a space, section by section, so the person watches it fill in, and it never changes words they typed without their yes.
license: MIT
---

# Docs

**First, before you read on:** run `node <this skill's folder>/assets/docs.js -C <folder>
start <link> "<title>" "<heading>" "<heading>" …`, with the space the person gave you
(`start --new "<title>" "<heading>" …` with none), where `<folder>` is an empty folder you
work in. The title is the document's name in the person's words. The headings are its
sections, three to seven, short and plain, in the order a reader needs them. Add
`--pages <n>` when the ask names a length ("a one-page proposal": `--pages 1`). Name them
from the ask in a few seconds; nothing else is decided yet.

`start` puts a status, the title and every heading on the page at once, each section
saying "Writing…", saves it, and prints the rest of this skill. Read that, then write.

**The person watches the page fill in.** A status within 10 seconds, the headings within
30, a new section at least every 45 seconds. Plan one section, write it, then plan the
next: never plan the whole document before the first section goes in.

You write text, never the page: `docs.js` turns it into the page, shows it on every open
tab and saves it. Never deploy, push or edit the page any other way.
