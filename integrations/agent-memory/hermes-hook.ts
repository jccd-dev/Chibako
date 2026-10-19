import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Translate the Hermes envelope and verify-gate continuation to the shared contract.
async function main() {
  if (process.env.CHIBAKO_MEMORY_ENABLED === "0") { process.stdout.write("{}\n"); return; }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 300_000) throw new Error("Hook payload exceeds limit");
    chunks.push(bytes);
  }
  const input = z.object({
    hook_event_name: z.string(), session_id: z.string(),
    extra: z.object({ user_message: z.string().optional(), turn_id: z.string().optional() }).passthrough().optional(),
  }).passthrough().parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const prompt = input.hook_event_name === "pre_llm_call";
  const compiled = import.meta.url.endsWith(".mjs");
  const script = fileURLToPath(new URL(compiled ? "./memory.mjs" : "../../scripts/agent-memory.ts", import.meta.url));
  const child = spawn(process.execPath, [...(compiled ? [] : ["--import", "tsx"]), script, "hermes"], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(JSON.stringify({
    session_id: input.session_id, hook_event_name: prompt ? "UserPromptSubmit" : input.hook_event_name === "pre_verify" ? "Stop" : "PreCompact",
    ...(input.extra?.turn_id ? { turn_id: input.extra.turn_id } : {}),
    ...(input.extra?.user_message ? { prompt: input.extra.user_message } : {}),
  }));
  const output: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  const result = z.object({ hookSpecificOutput: z.object({ additionalContext: z.string() }).optional(), systemMessage: z.string().optional(), decision: z.string().optional(), reason: z.string().optional() }).passthrough().parse(JSON.parse(Buffer.concat(output).toString("utf8")));
  const context = [result.hookSpecificOutput?.additionalContext, result.systemMessage].filter(Boolean).join("\n");
  if (input.hook_event_name === "pre_verify" && result.decision === "block") process.stdout.write(JSON.stringify({ action: "continue", message: result.reason }) + "\n");
  else if (prompt) process.stdout.write(JSON.stringify({ context }) + "\n");
  else if (result.systemMessage) process.stderr.write(result.systemMessage + "\n");
  if (code) process.exitCode = code;
}
main().catch(() => {
  process.stdout.write(JSON.stringify({ context: "Automatic memory hook failed; capture and retrieval are unverified." }) + "\n");
  process.exitCode = 1;
});
