// Scoreboard CLI. See GLOSSARY.md "Scoreboard".
//   npm run scoreboard -- --fixture                       fake Notes, no provider, no private data
//   npm run scoreboard -- --data-dir <tmp copy> --questions <file> [--final] [--label x] [--compare prev.json]
import { parseArgs } from "node:util";
import { createFixtureVault, FIXTURE_QUESTIONS } from "./scoreboard/fixture/vault";
import { assertTemporaryDataDir, compareResults, formatReport, loadQuestions, loadResult, runScoreboard, saveResult } from "./scoreboard/scoreboard";

const { values } = parseArgs({
  options: {
    fixture: { type: "boolean" },
    "data-dir": { type: "string" },
    questions: { type: "string" },
    final: { type: "boolean" },
    label: { type: "string" },
    out: { type: "string" },
    compare: { type: "string" },
  },
});

if (!values.fixture && !values["data-dir"]) {
  process.stderr.write("Pass --fixture, or --data-dir <temporary copy of a Vault>. The tool refuses non-temporary data directories.\n");
  process.exit(2);
}

async function main() {
  const fixture = values.fixture ? await createFixtureVault() : null;
  try {
    if (!fixture) {
      process.env.CHIBAKO_DATA_DIR = values["data-dir"];
      assertTemporaryDataDir(values["data-dir"]!);
    }
    const questions = loadQuestions(fixture ? FIXTURE_QUESTIONS : values.questions ?? ".scratch/vault-memory/questions.json");
    const result = await runScoreboard({ questions, final: values.final, label: values.label ?? (fixture ? "fixture" : "run") });
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
