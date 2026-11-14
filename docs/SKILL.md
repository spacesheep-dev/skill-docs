---
name: docs
description: Use when someone wants a document written on a page they and others will read, comment on and edit together, such as a proposal, a letter, a brief, a plan, a policy or a report. It writes the document live on a space, section by section, so the person watches it fill in, and it never changes words they typed without their yes.
license: MIT
---

# Docs

**First, before you read on or decide anything:** run
`node <this skill's folder>/assets/docs.js -C <folder> start <link>`, with the space the
person gave you (`start --new "<title>"` with none), where `<folder>` is an empty folder
you work in. It puts a status on the page at once and says what the space holds. When
it's empty, it prints how to write the outline, the next command. When it holds a
document already, it lists its blocks and prints the rest of this skill.

**The person watches the page fill in.** A status within 10 seconds, the headings within
30, a new section at least every 45 seconds. Plan one section, write it, then plan the
next: never plan the whole document before its first section goes in.

You write text, never the page: `docs.js` turns it into the page, shows it on every open
tab and saves it. Never deploy, push or edit the page any other way.
