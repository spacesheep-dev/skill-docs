# Spacesheep's Docs skill

Spacesheep's official Docs skill, in the [Agent Skills](https://agentskills.io/specification) format. The skill is the folder `docs/`. Everything else here is the repo's own, and never enters a version.

An agent with this skill writes a document on a space while the person watches: a status at once, the title and headings, then one section at a time. People type into the page and comment on it as it's written. The agent changes only the blocks it wrote; a change to the person's words is proposed in a comment and made only on their yes.

## What's in it

| Path | What it is |
|---|---|
| `docs/SKILL.md` | Part one: the first command, and the pace |
| `docs/references/outline.md` | Printed by `start`: the outline |
| `docs/references/writing.md` | Printed by `outline`: sections, comments, facts, length, done |
| `docs/references/page.html` | The starter page: no script, light and dark, A4 print |
| `docs/assets/docs.js` | Every command the agent runs, so a person allows one script |
| `docs/assets/blank-live-link*.html` | Spacesheep's working-on-it page, with and without its description: a space showing it counts as blank |
| `docs/spacesheep.yaml` | The skill's title, emoji and tags on Spacesheep |
| `tests/` | The repo's tests: `node tests/run.js`, no dependencies |

## How `docs.js` keeps the person's words

- Each block it writes has an id it made, and a hash of what it wrote, kept in the page's head.
- A block is the tool's only while its id appears once and it still reads as written. A block someone typed in, added, or split is the person's, for good.
- No command changes, moves or removes a person's block, on open tabs or in a save. New blocks go at the end of their section.
- Every save sends the exact old text of the section it changes. If someone changed it since the read, the save is refused, the saved words go back on open tabs, and the tool reads again.
- Text is escaped first; only a few plain marks (paragraphs, lists, a subheading, a quote, bold, italics, https links) become tags.

`tests/ownership.js` walks every command over a page a person has changed, and fails if a command is missing from the walk.

## Change it

1. Edit `docs/`, then check it:

   ```bash
   npx -y spacesheep@latest skills lint
   node tests/run.js
   ```

2. Add a heading for the version to `CHANGELOG.md` (`## v1.1.0`), with what changed under it.
3. Tag and push the version. `release.yml` checks the skill and makes the release.

- **Never move a tag.** Spacesheep keeps each tag once, with the commit it pointed at. Tag a new version instead.
