import { MemoryClientError } from "./memory/client-error";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import path from "node:path";
import { z } from "zod";
import { runMemoryEvent } from "./memory/runtime";
import { connectMemory } from "./memory/connection";
import { profileDirectory, readProfile } from "./memory/profile";
import { privateDirectory } from "./memory/private-files";
import { runControl } from "./memory/controls";
import { resolveProject } from "./memory/project";

const inputSchema = z.object({
  session_id: z.string().min(1).max(200), hook_event_name: z.string(), cwd: z.string().max(4096).optional(),
  turn_id: z.string().optional(), prompt: z.string().optional(), stop_hook_active: z.boolean().optional(),
}).passthrough();
let countingOnly = false;
const usage = `Usage: memory.mjs <codex|claude|hermes> [hook|stage|inspect|setup|status|doctor|pause|resume|disconnect] [--profile <name>] [--profile-dir <absolute path>] [--session <id>]
  hook     read a host hook event on stdin
  stage    read {"checkpoint"|"finish"|"skip"|"continue": ...} on stdin; expected_revision may sit inside it or beside it
  inspect  show this session's pending checkpoint and latest receipt (needs --session; read-only, offline)
  status   show the profile and pending state without the API key
  doctor   check the connection, scopes and hook files
`;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
async function readInput(): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 300_000) throw new Error("Hook payload exceeds limit.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function main(): Promise<void> {
  if (Number(process.versions.node.split(".")[0]) < 20) throw new MemoryClientError("Chibako Memory requires Node.js 20 or later.");
  const args = parseArgs({ allowPositionals: true, options: { profile: { type: "string" }, "profile-dir": { type: "string" }, session: { type: "string" }, help: { type: "boolean", short: "h" } } });
  if (args.values.help || !args.positionals[0]) { process.stdout.write(usage); return; }
  const runtime = z.enum(["codex", "claude", "hermes"]).parse(args.positionals[0]);
  const action = args.positionals[1] || "hook";
  const name = args.values.profile || process.env.CHIBAKO_MEMORY_PROFILE || "default";
  const directory = args.values["profile-dir"] || profileDirectory(runtime, name);
  if (!path.isAbsolute(directory)) throw new Error("Profile directory must be absolute.");
  if (!["hook", "stage"].includes(action)) {
    const result = await runControl(runtime, action, directory, name, args.values.session);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  // Keep the explicitly configured environment workflow compatible with existing installations.
  const legacy = process.env.CHIBAKO_MEMORY_ENABLED !== undefined && !process.env.CHIBAKO_MEMORY_PROFILE_DIR && !args.values["profile-dir"];
  const profile = await readProfile(directory);
  if (process.env.CHIBAKO_MEMORY_ENABLED === "0" || !(profile ? profile.enabled && profile.api_key : legacy && process.env.CHIBAKO_MEMORY_ENABLED === "1")) {
    process.stdout.write("{}\n"); return;
  }
  if (profile && profile.runtime !== runtime) throw new Error("Runtime does not match the configured memory profile.");
  let payload = await readInput();
  if (action === "stage" && args.values.session) {
    // The stage command carries the hook's session so agents need not supply it.
    const object = z.record(z.string(), z.unknown()).parse(payload);
    payload = { ...object, session_id: args.values.session, hook_event_name: "Checkpoint" };
  }
  const input = inputSchema.parse(payload);
  // A skipped count (e.g. a parallel hook holds the lock) must not surface as a user-visible failure.
  countingOnly = action === "hook" && input.hook_event_name === "PostToolUse";
  const connection = connectMemory(profile?.endpoint || process.env.CHIBAKO_MEMORY_MCP_URL || "", profile?.api_key || process.env.CHIBAKO_MEMORY_API_KEY || "", profile?.principal_id, profile?.area);
  const stateDirectory = profile ? path.join(directory, "state") : process.env.CHIBAKO_MEMORY_STATE_DIR || "";
  const start = Date.now();
  try {
    const command = (verb: string) => `node ${quote(fileURLToPath(import.meta.url))} ${runtime} ${verb} --profile-dir ${quote(directory)} --session ${quote(input.session_id)}`;
    const execute = async () => {
      const call = connection.call;
      const staged = action === "stage" ? z.object({ checkpoint: z.unknown().optional(), finish: z.unknown().optional(), now_line: z.unknown().optional(), skip: z.unknown().optional(), continue: z.unknown().optional(), replaces_request_id: z.unknown().optional(), expected_revision: z.unknown().optional() }).parse(payload) : undefined;
      const options = { runtime, input, directory: stateDirectory, enabled: true, call, resolveProject, ...(profile?.thresholds ? { thresholds: profile.thresholds } : {}),
        ...(profile ? { binding: { endpoint: profile.endpoint, principal_id: profile.principal_id, area: profile.area },
          stageCommand: command("stage"), inspectCommand: command("inspect") } : {}) };
      const result = await runMemoryEvent({ ...options, ...(staged ? { stage: staged } : {}) });
      const flushed = staged?.checkpoint || staged?.finish ? await runMemoryEvent({ ...options, input: { ...input, hook_event_name: "Checkpoint" } }) : {};
      process.stdout.write(JSON.stringify({ ...result, ...flushed }) + "\n");
    };
    // Events take only their per-session state lock: holding profile.lock across network calls made concurrent sessions fail as busy.
    // Profile writes are atomic renames, so an event racing setup finishes with the profile it read.
    if (profile) await privateDirectory(directory);
    await execute();
  } finally {
    await connection.close();
    process.stderr.write(`memory metrics: calls=${connection.calls} elapsed_ms=${Date.now() - start}; model usage not measured\n`);
  }
}
main().catch((error: unknown) => {
  if (countingOnly) { process.stdout.write("{}\n"); return; }
  // Report only field paths and rules: Zod issues may otherwise echo checkpoint content.
  const invalid = error instanceof z.ZodError ? `Invalid memory payload: ${error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}` : "";
  process.stdout.write(JSON.stringify({ systemMessage: invalid || (error instanceof MemoryClientError ? error.message : "Chibako Memory operation failed. Check the selected profile, private permissions, server status and connection. Capture is unverified; no credentials or checkpoint content were logged.") }) + "\n");
  process.exitCode = 1;
});
