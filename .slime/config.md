# JCCDLabs skills config

Read by the JCCDLabs skills. Edit by hand or rerun great-sage-setup. A missing section means the skill's built-in default.

## Plans
- Folder: .slime/plans/
- Save: on request
- When every slice is done: delete

## Handoffs
- Where: ask each time
<!-- JC names the place per handoff: chat, a file, or Chibako memory -->

## Checks
- Typecheck: npm run typecheck
- Lint: npm run lint
- Tests: npm test
- E2E: npm run test:e2e -- <spec>  (finance: npx playwright test -c playwright.finance.config.ts)
- MCP: npm run test:mcp-stdio  (when the MCP factory or its imports change)
- Build: npm run build  (framework, packaging, or cross-boundary changes)
- Known failures: none
- Full matrix: the "Verification and completion" table in AGENTS.md

## Code comments
- Policy: why-only

## Verification procedures (Kaijin)
- Folder: .agents/skills/

## PRs
- Base: main
- Who merges: user
- Merge method: squash
- Body: problem first, Evidence, Merge danger
- Never edit plugins/ or plugin-versions.json in a PR

## Models
| Work | Model | Effort |
| --- | --- | --- |
| Test runs, lint, typecheck, builds | Haiku | low |
| Complex multi-file implementation | Sonnet | medium |
| Planning, diagnosis, review, final verification | Opus | high |

## Octagram
- Members: Claude Opus high, GPT-6.2 Sol high
- Allowed on: T3 Code
- Use for: frontend design, plans, risky reviews, large PRs
- Max rounds: 3
