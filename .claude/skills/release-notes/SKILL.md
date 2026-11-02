---
name: release-notes
description: Suggest the next version number and create a draft GitHub release with player-facing release notes. Use when the user is preparing a release (e.g. "/release-notes", "draft the release notes", "what version should the next release be").
argument-hint: "[version, e.g. v0.6.0]"
---

# Release notes → draft GitHub release

Works out what changed since the last release, suggests a version, writes release notes for **players**, and creates a **draft** GitHub release. It never publishes and never pushes a tag: the user publishes from the GitHub UI.

`$ARGUMENTS` may be a version to use. Without one, suggest it (step 2) and tell the user which one you used; the draft is easy to change.

## 1. Gather what changed

1. `git fetch --tags -q`, then find the last release: `gh release list --limit 5` (and `git tag --sort=-creatordate | head`). `package.json` stays at `0.0.0` on purpose: the git tags are the version source, do not bump it.
2. `git log <last-tag>..HEAD --pretty='%h %s'` for the commits. If there are none, stop and say so.
3. Read the PR descriptions behind the user-facing commits (`gh pr view <n> --json title,body`). The commit subjects are too terse and are written for developers; the PR bodies explain what the user sees. Skip docs, CI, dependency and refactor PRs, you only need their subjects.
4. If a feature was added and then reworked inside the same range (a flag added in one PR and replaced in the next), describe the **end state** only. Users upgrading from the last release never saw the intermediate one.
5. Check whether saved plans change shape: `git diff <last-tag>..HEAD -- src/data/schema.ts src/store/persistence.ts`. A migration, a renamed field or a changed solver result belongs in the "Upgrading" section.

## 2. Suggest a version

The project is pre-1.0 and tags are `vMAJOR.MINOR.PATCH`.

- **Minor** (`0.4.0` → `0.5.0`): new user-visible features, or a behaviour change that can alter existing plans' results.
- **Patch** (`0.4.0` → `0.4.1`): only fixes and small improvements, no behaviour change.
- **1.0.0** is the user's call. Never suggest it unprompted.

Say which rule applied in one or two sentences, so the user can overrule you.

## 3. Write the notes

Write for someone who plays Factorio and uses the planner, not for a developer. Describe what they can **see and do**. The notes are a changelog people skim, not documentation: the detail of how each menu works belongs in the README and `spec/ui.md`.

### What to include

- No internals: solver or LP terms, tolerances, rounds, store, schema field names, component names, graph tags or data-testids, test or CI details.
- No developer-only fixes (dev server, build scripts) and no changes with no UI (an undoable action that has no button yet).
- No pure cosmetic restyles, and no filler line for dependency or documentation updates.
- Use the words the UI uses (menu entries, pane names, button labels) in **bold**, exactly as they appear, the first time they come up. Not italics, and not on every mention. When a label was renamed, say so.
- Describe a bug fix by its symptom ("icons looked almost black"), not its cause. Mention scale only when it helps ("hundreds of items in the Seablock data").
- Concrete numbers from a real plan beat abstract descriptions (the Seablock example with rates, for instance).
- Assume the reader knows Factorio. Do not explain game concepts or why a setting is useful in the game ("so you need fewer reactors", "handy when an intermediate is built next to its consumers"). State what the planner does.

### Length and shape

The reader decides in seconds whether to keep reading, so it must scan quickly and stay short. A first draft is usually twice too long: cut it.

- A feature gets one or two sentences, then at most about five bullets. Bullets cover what the player can do, not every menu entry, chip, popup, secondary view or display detail.
- One idea per bullet, one or two lines each. Keep short bold labels (one to three words, followed by a colon) on bullets that introduce a distinct thing, so the list can be scanned. Without them the sections turn into a wall of text. A bullet that is a plain sentence does not need one.
- State a limitation once, at the place it applies ("Nullius has no generation recipes yet"), not as a closing caveat on every section. Setup requirements for a new feature are the exception: one bullet.
- Do not pad a section to look like the others. A small feature is a sentence, a big one gets bullets. Drop the intermediate "Improvements" bucket: small changes go in "Other changes".

### Wording that reads as machine-written

Avoid these, they were the tells in earlier drafts:

- Headings of the form "Topic: tagline" ("Separate areas: build the same recipe in several places"). Use the plain feature name.
- "X used to be Y. Now you can Z.", "Before, you could only…", and "instead of building a whole chain just to…" as openings. Say what the feature does.
- Colons and parentheses used to chain clauses in one sentence. Split it, or drop the aside.
- Every bullet shaped the same: bold label, full sentence, period. Mix short and long.
- Explaining the obvious ("whatever the rate unit", "so every row balances").

### Structure

In this order, omitting empty sections:

```markdown
## Highlights

### <Feature name>

<One or two sentences, then bullets for the notable parts.>

## Bug fixes

- **<Symptom>:** <What it does now.>

## Other changes

- <Small improvement, in a plain sentence.>

## Upgrading from <last version>

<What happens to saved plans. Whether totals in existing plans can change, and why. What to do before going back to an older version, if the saved format changed. If nothing changes: "Nothing to do: saved plans carry over unchanged.">

**Full Changelog**: https://github.com/fmonniot/factorio-planner/compare/<last-tag>...<new-tag>
```

Bug fixes always get their own section, even for a single fix: players look for it. Keep "Upgrading" to a few lines (saved plans convert automatically, which blocks can change totals, and the downgrade warning); do not walk through every new setting that old plans don't have.

Sample of the intended tone and density:

```markdown
### Power generation

Set an Electricity product (10 MW, say) and the planner works out the generators, boilers, fuel and water behind it, back to raw inputs.

- **Generators:** boilers, steam engines, turbines, burner generators and solar panels (counted at 70 % of peak) are picked like any other recipe.
- **Reactor neighbours:** the **Edit machine** modal takes the average number of working reactors next to each one (2.5 for a 2×4 block).
- Seablock has all of this, Nullius has no generation recipes yet.
```

Rules for the file you write:

- Write it to the scratchpad directory, not the repository.
- Do **not** hard-wrap prose: one paragraph or list item per line (see the user's global instructions on writing for GitHub).
- No Claude attribution lines in a release body.
- Name the release `<new-tag>` (for example `v0.5.0`), like the existing releases.

Before creating the draft, reread it once against the length and wording rules above, and cut what fails them.

## 4. Create the draft

```sh
gh release create <new-tag> --draft --target main --title "<new-tag>" --notes-file <file>
```

`gh` may create the draft under an `untagged-…` URL and a placeholder tag name. Check it and fix it so publishing creates the right tag:

```sh
id=$(gh api repos/fmonniot/factorio-planner/releases --jq '.[] | select(.draft) | .id' | head -1)
gh api -X PATCH repos/fmonniot/factorio-planner/releases/$id -f tag_name=<new-tag> -f target_commitish=main --jq '"\(.draft) tag=\(.tag_name) url=\(.html_url)"'
```

To revise an existing draft later, PATCH `-F body=@<file>` on the same id (or `gh release edit <tag> --notes-file <file>`). If there is already a draft, update it instead of creating a second one. Editing a draft changes its `untagged-…` URL, so always give the user the URL from the latest response.

## 5. Report

Reply with:

- the draft URL (take it from the last PATCH response, it can change),
- the version and the one-line reason for it,
- anything you left out or judged on purpose (an intermediate feature skipped, a claim inferred from the code rather than tested, any non-user visible features, detail you cut for length), so the user can overrule it.

The release is a draft: say that nothing is published or tagged until the user publishes it.
