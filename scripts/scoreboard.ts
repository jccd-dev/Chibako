// Scoreboard CLI. See GLOSSARY.md "Scoreboard".
//   npm run scoreboard -- --fixture                       fake Notes, no provider, no private data
//   npm run scoreboard -- --data-dir <tmp copy> --questions <file> [--final] [--label x] [--compare prev.json]
//   npm run scoreboard -- --source-dir <real vault> --questions <file> ...   backs the Vault up to a temp copy, runs, deletes the copy
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { backupVaultToTemp } from "./scoreboard/backup";
import { createFixtureVault, FIXTURE_QUESTIONS } from "./scoreboard/fixture/vault";
import { assertTemporaryDataDir, compareResults, formatReport, loadQuestions, loadResult, runScoreboard, saveResult } from "./scoreboard/scoreboard";

const { values } = parseArgs({
  options: {
    fixture: { type: "boolean" },
    "data-dir": { type: "string" },
    "source-dir": { type: "string" },
    questions: { type: "string" },
    final: { type: "boolean" },
    label: { type: "string" },
    out: { type: "string" },
    compare: { type: "string" },
  },
});

if (!values.fixture && !values["data-dir"] && !values["source-dir"]) {
  process.stderr.write("Pass --fixture, --source-dir <Vault to back up>, or --data-dir <temporary copy of a Vault>. The tool refuses non-temporary data directories.\n");
  process.exit(2);
}

async function main() {
  // Embedding provider settings come from the environment; load local env files (existing variables win).
  if (!values.fixture) for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
  const fixture = values.fixture ? await createFixtureVault() : values["source-dir"] ? await backupVaultToTemp(values["source-dir"]) : null;
  try {
    const dir = fixture?.dir ?? values["data-dir"]!;
    if (!values.fixture) {
      process.env.CHIBAKO_DATA_DIR = dir;
      assertTemporaryDataDir(dir);
    }
    const questions = loadQuestions(values.fixture ? FIXTURE_QUESTIONS : values.questions ?? ".scratch/vault-memory/questions.json");
    const result = await runScoreboard({ questions, final: values.final, label: values.label ?? (values.fixture ? "fixture" : "run") });
    const file = saveResult(result, values.out ?? ".scratch/vault-memory/results");
    process.stdout.write(`${formatReport(result)}\nSaved ${file}\n`);
    if (values.compare) process.stdout.write(`${compareResults(loadResult(values.compare), result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    fixture?.cleanup();
  }
}

void main();
