# Changelog

Each release is a heading with its tag. The release workflow uses the words under it as the release's notes.

## v1.0.3

- Docs pages open in Edit: the page carries `<meta name="ss-edit" content="open">`, so a person who may edit it can type on it straight away, even while Docs is still writing. Docs writes around what they type and never waits for them or undoes it.
- A page Docs made with v1.0.0 to v1.0.2 gets the line with its next save, once, after the ledger. A page that already has a meta named `ss-edit`, with any value, is left as it is, and reading a page (`start`) never changes it.
- The folder's hash is `26bdac051742`.

## v1.0.2

- A blank Docs page that the person has typed a few lines on is now Docs' page to write on. Their lines stay where they typed them, unchanged, and the document is written after them. Docs reads the lines first, as the person's brief, and can use the first one as the document's title.
- Only typed text counts: paragraphs, headings, lists, quotes and code, with plain links and marks. A picture, an embed, a script, a style, a link to anything but a web, mail or phone address, or an id of Docs' own still makes the page the person's, and Docs asks first.
- The folder's hash is `15ac30c4a831`.

## v1.0.1

- A space made with New space or Start from blank holds the app's empty sheet; Docs now counts it as blank and writes there without asking. Anything added to that sheet still makes the page the person's.
- When a space holds a page someone made, Docs' refusal now says what to do with the answer: if the person says to write on that page anyway, the document goes on a new page, never saved over theirs.
- The folder's hash is `7aa5b718a758`.

## v1.0.0

- The first Docs skill: a document written live on a space, section by section; comments become edits on their own block; changes to the person's words wait for their yes; the printed length is checked against what was asked.
- The folder's hash is `d90f207238e5`.
