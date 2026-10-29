// Entry for the bundled Hermes Python plugin: reads one Hermes callback envelope on stdin.
import { runMemoryCli } from "../../scripts/memory/cli";
import { hermes } from "../../scripts/memory/hermes/adapter";

void runMemoryCli(hermes, ["hermes", "hook"]);
