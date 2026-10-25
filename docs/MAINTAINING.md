# Maintaining Chibako

A beginner-friendly guide for the owner: how changes reach `main` and how the agent
memory plugins get released. Contributors read [CONTRIBUTING.md](../CONTRIBUTING.md).

## Words you'll see

- **Branch**: a separate copy of the code where one task happens.
- **PR (pull request)**: a request to merge a branch into `main`. You review it there.
- **Check**: an automatic test CI runs on a PR. ✅ passed, ❌ a real problem.
- **Squash and merge**: all of a PR's commits become one commit on `main`. It's the
  only merge method enabled, and the branch is deleted afterwards.
- **Plugin version**: the number in `plugin.json`, for example `0.4.1`. Users only
  get a plugin update when it goes up.
- **Label**: a tag in the PR sidebar. `plugin: minor` asks for a bigger version jump.

## Version numbers

```
0 . 4 . 1
    │   └── patch: small fix, users do nothing          (default, no label needed)
    └────── minor: new feature or users must re-setup   (add label "plugin: minor")
```

Plugin versions are separate from app versions. App releases (`v0.1.<run>`) come
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
2. A green **Plugin output** check with "Plugin changes detected" means the plugin
   will be released after merge. Decide:
   - small fix → do nothing (patch)
   - new feature or setup change → add the `plugin: minor` label
3. Approve, then **Squash and merge**.
4. After a few minutes a bot commit `chore(plugins): release X.Y.Z` appears on
   `main`. Users can now update.

## What happens after merge

`.github/workflows/plugin-release.yml` runs on every push to `main`:

1. Rebuilds `plugins/` from source. If nothing changed, it stops: no release.
2. Reads the merged PR's labels: `plugin: minor` → minor, otherwise patch.
3. Bumps `plugin.json`, rebuilds, syncs `.claude-plugin/marketplace.json`, and runs
   the agent memory tests.
4. Commits `chore(plugins): release X.Y.Z` as `github-actions[bot]` and pushes
   without force. That push starts no other workflow, so it can't loop or trigger
   an app release.

## Scenarios

- **Finance-only change**: green checks, merge, no plugin release.
- **Memory-hook fix, no label**: merge → bot releases `0.4.1`.
- **New skill with `plugin: minor`**: merge → bot releases `0.5.0`.
- **Contributor committed `plugins/`**: the Plugin output check fails and tells them
  to run `git checkout origin/main -- plugins`.
- **You forgot the minor label**: it ships as a patch. Harmless; users still get it.
- **Release job failed** (network, etc.): re-run it from the Actions tab. It reads the
  current state, so it never double-bumps.
- **Two merges close together**: if `main` moved during a release, that run stops
  quietly and the next run releases the combined change.
- **Need a release by hand**: Actions → Plugin release → Run workflow, pick
  `patch` or `minor`.
- **No bot commit after a plugin PR**: check Actions → Plugin release.

## Things you never need to do

- Edit the version in `plugin.json` (only an unusual major or `1.0` release would)
- Run `npm run publish:memory-plugins` for a release
- Open a separate release PR

## Repository settings

- Only squash merges are allowed; squash commits use the PR title and description.
- Branches are deleted automatically after merge.
- `main` has no ruleset. If you add one that requires PRs or checks, give the
  release bot a bypass (a GitHub App) instead of weakening the rule.
