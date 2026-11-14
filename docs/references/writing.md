# Writing the document

The outline is on the page. Now write it, one section at a time, in order.

## One section, one command

Section 0 is the opening, before the first heading: one or two sentences saying what
this is and what it asks of the reader. Then sections 1, 2, … as `start` listed them.

    node docs.js -C <folder> write <n> - "Writing <the next heading>" <<'TEXT'
    <the section's text>
    TEXT

The status names what comes next, so the person always knows. Write a section, push it
with that command, then think about the next one. A section that grows long is two
commands: the first half, then `write <n>` again with the whole section.

## The text

Plain text, never HTML. A blank line starts a new paragraph. In a paragraph, a line
break stays a line break (an address, a sign-off).

- Lines starting `- ` are a list; `1. ` a numbered list.
- A line starting `### ` is a subheading inside the section.
- Lines starting `> ` are a quote.
- `**bold**`, `*italics*` and `[words](https://link)`. Nothing else is markup: every other
  character shows as typed.

`write <n>` replaces what you wrote in that section before with this text, so send the
whole section each time.

## The person's words are theirs

People can type into the page while you write. `docs.js` keeps what they type:

- A block they typed in, or added, is theirs. `write` never changes, moves or removes it,
  and says so: "the person changed d-s2-1: theirs now". Your text goes in around it, at
  the end of the section.
- Read theirs before you write that section again: `node docs.js -C <folder> blocks <n>`
  lists each block, whose it is, and its words. Don't repeat what they wrote, and don't
  write around it to undo it.
- To change their words, ask: say in your reply exactly what you would change and why.
  Never retype their block as yours.

## Facts and length

- Never invent a fact the person didn't give: a name, a date, an amount, an address, a
  clause. Write it in square brackets, `[landlord's name]`, for them to fill in.
- Write to the length they asked for. A printed A4 page holds about 400 words with its
  headings. With no length named, keep each section to what a reader needs.
- Say each thing once, in the reader's words. No filler openings, no summary that
  repeats the sections.

## When every section is written

    node docs.js -C <folder> done

It checks that no section still says "Writing…", and lists the bracketed blanks. If it
says not done, fix what it names, then `done` again. Then reply to the person in two or
three lines: what the document holds, the blanks for them to fill in, and anything you'd
change in words they typed.
