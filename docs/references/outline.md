# The outline, now

The status is on the page. Next, in a few seconds, put up the outline:

    node docs.js -C <folder> outline "<title>" "<heading>" "<heading>" … [--pages <n>]

- The title is the document's name, in the person's words.
- The headings are its sections: three to seven, short and plain, in the order a reader
  needs them. You can't add one later, so name each part the ask needs.
- When `start` quoted lines the person typed and their first line is the title, give
  `--their-title` in place of the title: their line stays the title, as they typed it.
- `--pages <n>` when the ask names a length ("a one-page proposal": `--pages 1`). `done`
  then checks the printed length against it.

Decide only these. The sections' words come after, one at a time. `outline` puts the
title and headings on the page, each section saying "Writing…", saves it, and prints how
to write the sections.
