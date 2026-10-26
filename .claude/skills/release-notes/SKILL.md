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
4. Read the previous release (`gh release view <last-tag> --json body -q .body`) and match its structure.
5. If a feature was added and then reworked inside the same range (a flag added in one PR and replaced in the next), describe the **end state** only. Users upgrading from the last release never saw the intermediate one.
6. Check whether saved plans change shape: `git diff <last-tag>..HEAD -- src/data/schema.ts src/store/persistence.ts`. A migration, a renamed field or a changed solver result belongs in the "Upgrading" section.

## 2. Suggest a version

The project is pre-1.0 and tags are `vMAJOR.MINOR.PATCH`.

- **Minor** (`0.4.0` → `0.5.0`): new user-visible features, or a behaviour change that can alter existing plans' results.
- **Patch** (`0.4.0` → `0.4.1`): only fixes and small improvements, no behaviour change.
- **1.0.0** is the user's call. Never suggest it unprompted.

Say which rule applied in one or two sentences, so the user can overrule you.

## 3. Write the notes

Write for someone who plays Factorio and uses the planner, not for a developer. Describe what they can **see and do**, and why it matters. Leave out anything they could not act on or recognise:

- No internals: solver or LP terms, tolerances, rounds, store, schema field names, component names, graph tags or data-testids, test or CI details.
- No developer-only fixes (dev server, build scripts) and no changes with no UI (an undoable action that has no button yet). A single line under "Other" for dependency and documentation updates is enough.
- Use the words the UI uses (menu entries, pane names, button labels) in *italics* or **bold**, exactly as they appear. When a label was renamed, say so.
- Describe a bug fix by its symptom ("icons looked almost black"), not its cause. Mention scale only when it helps ("hundreds of items in the Seablock data").
- Concrete examples from the game beat abstract descriptions.

Structure, in this order, omitting empty sections:

```markdown
## Highlights

### <Feature name, phrased as what the player gets>

<One or two sentences, then bullets for the notable parts.>

## Improvements

- **<Short name>.** <What changed for the player.>

## Bug fixes

- **<Symptom>.** <What it does now.>

## Other

- Dependency and documentation updates.

## Upgrading from <last version>

<What happens to saved plans. Whether totals in existing plans can change, and why. What to do before going back to an older version, if the saved format changed. If nothing changes: "Nothing to do: saved plans carry over unchanged.">

**Full Changelog**: https://github.com/fmonniot/factorio-planner/compare/<last-tag>...<new-tag>
```

Rules for the file you write:

- Write it to the scratchpad directory, not the repository.
- Do **not** hard-wrap prose: one paragraph or list item per line (see the user's global instructions on writing for GitHub).
- No Claude attribution lines in a release body.
- Name the release `<new-tag>` (for example `v0.5.0`), like the existing releases.

## 4. Create the draft

```sh
gh release create <new-tag> --draft --target main --title "<new-tag>" --notes-file <file>
```

`gh` may create the draft under an `untagged-…` URL and a placeholder tag name. Check it and fix it so publishing creates the right tag:

```sh
id=$(gh api repos/fmonniot/factorio-planner/releases --jq '.[] | select(.draft) | .id' | head -1)
gh api -X PATCH repos/fmonniot/factorio-planner/releases/$id -f tag_name=<new-tag> -f target_commitish=main --jq '"\(.draft) tag=\(.tag_name) url=\(.html_url)"'
```

To revise an existing draft later, PATCH `-F body=@<file>` on the same id. If there is already a draft, update it instead of creating a second one.

## 5. Report

Reply with:

- the draft URL (take it from the last PATCH response, it can change),
- the version and the one-line reason for it,
- anything you left out or judged on purpose (an intermediate feature skipped, a claim inferred from the code rather than tested, any non-user visible features), so the user can overrule it.

The release is a draft: say that nothing is published or tagged until the user publishes it.
