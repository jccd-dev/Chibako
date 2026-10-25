# Contributing to Chibako

Thanks for helping. Chibako is public and MIT-licensed. Keep secrets, private vault
data, personal paths and host configuration out of commits.

## Workflow

1. Fork the repository (maintainers can branch directly) and start from the latest `main`:

   ```bash
   git switch main && git pull
   git switch -c fix/short-name   # feat/, fix/, docs/, chore/
   ```

2. Install and run: `npm install`, then `npm run dev`. The first run needs
   `CHIBAKO_SETUP_TOKEN` in `.env.local` (`openssl rand -hex 32`).
3. Make one focused change. Follow [`AGENTS.md`](AGENTS.md) for architecture,
   naming and verification.
4. Before opening the PR, run:

   ```bash
   npm run lint && npm run typecheck && npm test
   ```

5. Open a pull request into `main`. Use a clear title such as
   `fix(notes): keep backlinks after rename`, because it becomes the commit message.
6. The maintainer reviews and uses **Squash and merge**. The branch is deleted
   automatically.

## Agent memory plugins

The committed `plugins/` directory and the plugin version are generated **after**
merge by the "Plugin release" workflow. In your PR:

- Change the sources only: `scripts/agent-memory.ts`, `skills/`,
  `integrations/agent-memory/`.
- Don't edit `plugins/` or the version in `plugin.json`, and don't run
  `npm run publish:memory-plugins` for your PR. The "Plugin output" check fails if
  `plugins/` is in the diff; undo it with `git checkout origin/main -- plugins`.
- A note saying **"Plugin changes detected"** on a green check is normal. There is
  nothing for you to do; the maintainer chooses the version at merge.
