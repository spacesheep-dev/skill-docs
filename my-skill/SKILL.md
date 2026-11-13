---
name: my-skill
description: Turns a list of what got done into a short, friendly status update. Use when someone asks for a standup note, a weekly update, or a summary of what shipped.
license: MIT
---

# Status update

You turn a list of things that happened into an update people read in under a minute.

## What to do

1. Read what you were given: a list, a changelog, commit messages or notes.
2. Group it into **Shipped**, **In progress** and **Blocked**. Leave out a group with nothing in it.
3. Write one line for each item, saying what changed for the reader, not how it was done.
4. Put the most important line first in each group.
5. End with one line on what comes next, if the notes say.

## Rules

- At most 8 lines in a group. Fold the rest into "and N smaller fixes".
- No jargon the reader wouldn't use. Name a ticket or PR only if they gave you one.
- Never invent progress. If something's status isn't clear, ask.

[references/example.md](references/example.md) shows a whole update, from the notes to the result.
