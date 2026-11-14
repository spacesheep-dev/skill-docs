---
name: docs
description: Use when someone wants a document written on a page they and others will read, comment on and edit together, such as a proposal, a letter, a brief, a plan, a policy or a report. It writes the document live on a space, section by section, so the person watches it fill in, and keeps every word they typed.
license: MIT
---

# Docs

The person watches the page while you write. They see a status within 10 seconds, the
title and every heading within 60, and then one section at a time, each pushed as soon
as it is written. Never plan the whole document before the first push.

Work in an empty folder: the page is `<folder>/page/index.html`, one file. Every
command below takes `--space-id <id>`, the space the person gave you.

## 1. A status, at once

`spacesheep live push --space-id <id> --status "Planning the document"`

## 2. The outline, within 60 seconds

Decide only the title, a one-line lede and the section headings, in the person's words.
Write `index.html`: a plain page, one readable column, a short stylesheet in `<head>`
that works in light and dark, and no script. Each section is

    <section data-ss-id="s1"><h2 data-ss-id="s1-h">Heading</h2>
    <p data-ss-id="s1-p1" class="todo">Writing…</p></section>

numbered s1, s2, … in order. Then show it, and save it so a later visitor sees it:

    spacesheep live push --space-id <id> --html "$(cat page/index.html)"
    spacesheep deploy page --space <id> -m "Outline"

## 3. One section at a time

Write the section, replace it in `index.html`, then push only that section, with a
status naming the next one:

    spacesheep live push --space-id <id> --status "Writing <next heading>" \
      --edits '[{"anchor":"s2","op":"replace","html":"<section data-ss-id=\"s2\">…</section>"}]'

Each paragraph, list item and heading gets its own `data-ss-id` (`s2-p1`, `s2-p2`, …),
kept for the life of the document. After every two sections, save:
`spacesheep deploy page --space <id> -m "<what's in>"`.

## Rules

- Text is text. Write `&`, `<` and `>` in the person's words as `&amp;`, `&lt;`, `&gt;`.
  Only `h1`–`h3`, `p`, `ul`, `ol`, `li`, `strong`, `em`, `a`, `blockquote` and `table`
  inside a section: plain markup is what people can type into together.
- Never change words the person typed on the page. `deploy` merges what people typed
  since your last save; never pass `--replace`.
- A placeholder is the only thing you write that the person didn't ask for. Don't invent
  facts: where you need one (a name, a date, an amount), write it in brackets.

## When it's done

Save with `-m "Done"`, then reply to the person in two or three lines: what the
document holds, and what they should check.
