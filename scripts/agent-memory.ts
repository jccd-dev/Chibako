// Source-checkout dispatcher for manual hooks and tests. Packages bundle one host entry each (scripts/memory/<host>/main.ts).
import { runMemoryCli, usage } from "./memory/cli";
import { codex } from "./memory/codex/adapter";
import { claude } from "./memory/claude/adapter";
import { hermes } from "./memory/hermes/adapter";

const host = [codex, claude, hermes].find((candidate) => candidate.runtime === process.argv[2]);
if (host) void runMemoryCli(host);
else if (!process.argv[2] || ["-h", "--help"].includes(process.argv[2])) process.stdout.write(usage);
else {
  process.stdout.write(JSON.stringify({ systemMessage: "Unknown runtime. Use codex, claude or hermes." }) + "\n");
  process.exitCode = 1;
}
