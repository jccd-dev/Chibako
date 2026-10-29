# Maintaining Chibako

A beginner-friendly guide for the owner: how changes reach `main` and how the agent
memory plugins get released. Contributors read [CONTRIBUTING.md](../CONTRIBUTING.md).

## Words you'll see

- **Branch**: a separate copy of the code where one task happens.
- **PR (pull request)**: a request to merge a branch into `main`. You review it there.
- **Check**: an automatic test CI runs on a PR. ✅ passed, ❌ a real problem.
- **Squash and merge**: all of a PR's commits become one commit on `main`. It's the
  only merge method enabled, and the branch is deleted afterwards.
- **Plugin target**: one installable package: `claude`, `codex` or `hermes`.
- **Plugin version**: each target's number in `plugin-versions.json`, for example
  `0.4.1`. Targets are versioned separately; users only get an update for their
  target when its number goes up.
- **Label**: a tag in the PR sidebar. `plugin: minor` asks for a bigger version jump.

## Version numbers

```
0 . 4 . 1
    │   └── patch: small fix, users do nothing          (default, no label needed)
    └────── minor: new feature or users must re-setup   (add label "plugin: minor")
```

Plugin versions are separate from app versions and from each other. App releases (`v0.1.<run>`) come
from `.github/workflows/release.yml`; publishing never deploys a running instance.

## Your own change

1. `git switch main && git pull`
2. `git switch -c fix/short-name` (`feat/`, `docs/`, `chore/` also work)
3. Make the change, then `npm run lint && npm run typecheck && npm test`
4. `git push -u origin fix/short-name`, then open a PR into `main`
5. Wait for green checks. For a bigger plugin change, add the `plugin: minor` label.
6. **Squash and merge**
7. `git switch main && git pull`, and `git branch -d fix/short-name`

## A contributor's PR

1. Read the code and the checks. ❌ means a real problem; ask them to fix it.
2. A green **Plugin output** check with "Plugin changes detected" names the targets
   that will be released after merge. Decide:
   - small fix → do nothing (patch)
   - new feature or setup change → add the `plugin: minor` label
3. Approve, then **Squash and merge**.
4. After a few minutes a bot commit such as `chore(plugins): release codex 0.6.1`
   appears on `main`. Users of that target can now update.

## What happens after merge

`.github/workflows/plugin-release.yml` runs on every push to `main`:

1. Rebuilds each `plugins/<target>` from source at its current version. A target
   whose output didn't change is skipped: no release, no bump.
2. Reads the merged PR's labels: `plugin: minor` → minor, otherwise patch. The
   level applies to every changed target.
3. Bumps each changed target in `plugin-versions.json`, rebuilds it, and syncs the
   Claude entry in `.claude-plugin/marketplace.json` when Claude changed.
4. Runs the shared agent memory tests once, then each changed target's package test.
   A shared failure withholds every changed target; a target failure withholds only
   that target. Withheld targets are restored to their committed output and version.
5. Commits the released targets (`chore(plugins): release codex 0.6.1, hermes 0.6.1`)
   as `github-actions[bot]` and pushes without force. That push starts no other
   workflow, so it can't loop or trigger an app release.
6. Lists every target as unchanged, released or withheld in the run summary. Any
   withheld target fails the run so you notice it.

## Scenarios

- **Finance-only change**: green checks, merge, no plugin release.
- **Codex-only hook fix, no label**: merge → bot releases only `codex 0.4.1`;
  Claude and Hermes keep their versions.
- **Shared memory fix**: every target whose package changed is released.
- **New skill with `plugin: minor`**: merge → bot releases each target at its next minor.
- **One target withheld**: the run fails and names it; the others are released. Fix
  the cause, merge, and the next run releases it (or re-run with that target).
- **Contributor committed `plugins/`**: the Plugin output check fails and tells them
  to run `git checkout origin/main -- plugins`.
- **You forgot the minor label**: it ships as a patch. Harmless; users still get it.
- **Release job failed** (network, etc.): re-run it from the Actions tab. It reads the
  current state, so a target that was already released is never bumped again.
- **Two merges close together**: if `main` moved during a release, that run stops
  quietly and the next run releases the combined change.
- **Need a release by hand**: Actions → Plugin release → Run workflow, pick
  `patch` or `minor` and `all` or one target. Only targets whose output changed
  are released.
- **No bot commit after a plugin PR**: check Actions → Plugin release.

## Things you never need to do

- Edit `plugin-versions.json` (only an unusual major or `1.0` release would)
- Run `npm run publish:memory-plugins` for a release
- Open a separate release PR

## Repository settings

- Only squash merges are allowed; squash commits use the PR title and description.
- Branches are deleted automatically after merge.
- `main` has no ruleset. If you add one that requires PRs or checks, give the
  release bot a bypass (a GitHub App) instead of weakening the rule.
