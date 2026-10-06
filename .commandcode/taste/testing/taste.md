# Testing & verification preferences

- Test sub-agent scope: never edit source/tests/config, commit, spawn children, start servers, create vault/build channels, or touch production; reuse the already-running dev server. Confidence: 0.85
- E2E fixtures: create only new prefixed synthetic fixtures (e.g., "TEST 09 ..."); never mutate earlier TEST records or real user data; report only synthetic details. Confidence: 0.8
- UI verification checklist: responsive at 1440x900 and 390x844, native selects, full-width mobile sheets, no horizontal overflow, keyboard focus, and light/dark states. Confidence: 0.6
- When waiting for a pending frontend build, bound the wait (~60s) and report "pending frontend" rather than polling indefinitely. Confidence: 0.7
- Save browser verification reports to `.scratch/<project>/checks/ticketNN-browser.md` with concise evidence, persistent fixture IDs/names/states, and screenshot paths (attach via `preview_snapshot` with save:true). Confidence: 0.7
