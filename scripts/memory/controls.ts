import { MemoryClientError } from "./client-error";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { connectMemory } from "./connection";
import { localStatus, readProfile } from "./profile";
import { applySetup, prepareSetup, redactedPreview, inspectConnection, duplicateHookFiles, disconnect, setEnabled, writeConnectionCheck } from "./setup";
import { readOptional } from "./private-files";
import { renderHostConfig } from "./host-config";
import { inspectMemoryState, type Runtime } from "./runtime";
import path from "node:path";

export async function runControl(runtime: Runtime, action: string, directory: string, name: string, session?: string): Promise<object> {
  if (process.platform === "win32") throw new MemoryClientError("Windows private storage is not supported yet.");
  const configured = await readProfile(directory);
  if (configured && configured.runtime !== runtime) throw new MemoryClientError("Selected profile belongs to another runtime.");
  if (action === "status") return localStatus(directory);
  if (action === "inspect") {
    if (!configured) throw new MemoryClientError("No configured profile. Run setup first.");
    if (!session) throw new MemoryClientError("Inspect needs --session with the hook session_id.");
    // Explicitly requested private evidence for this session only; the profile key is never read into the result.
    return inspectMemoryState({ runtime, directory: path.join(directory, "state"), session_id: session,
      binding: { endpoint: configured.endpoint, principal_id: configured.principal_id, area: configured.area } });
  }
  if (action === "pause") { await setEnabled(directory, false); return { enabled: false, pending_retained: true }; }
  if (action === "disconnect") { await disconnect(directory); return { enabled: false, disconnected: true, pending_retained: true, key_revocation: "owner action" }; }
  if (action === "setup") return setupWizard(runtime, directory, name);
  const profile = await readProfile(directory);
  if (!profile?.api_key) throw new MemoryClientError("No configured profile. Run setup first.");
  const connection = connectMemory(profile.endpoint, profile.api_key, profile.principal_id, profile.area);
  try {
    if (action === "resume") {
      await setEnabled(directory, true, connection.call);
      return { enabled: true, capture_verified: false, next: "Approve native hooks and verify a new session and substantive turn." };
    }
    if (action === "doctor") {
      renderHostConfig(profile.runtime, await readOptional(profile.host.file), profile.endpoint, profile.api_key, profile);
      const status = await inspectConnection(connection.call, profile);
      return { connected: true, scopes: status.scopes, area: status.area,
        duplicate_hook_files: await duplicateHookFiles(runtime, profile.host.file),
        ...(await localStatus(directory)), node: process.version, platform: process.platform,
        host_events: "Actual host delivery and native hook consent require verification; connection alone is insufficient." };
    }
    throw new MemoryClientError("Unknown control. Use setup, status, inspect, doctor, pause, resume or disconnect.");
  } finally { await connection.close(); }
}

async function setupWizard(runtime: Runtime, directory: string, name: string): Promise<object> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new MemoryClientError("Setup requires your interactive terminal. Enter the API key there, never in agent chat, arguments or a pipe.");
  let hidden = false;
  const output = new Writable({ write(chunk, _encoding, done) { if (!hidden) process.stdout.write(chunk); done(); } });
  const readline = createInterface({ input: process.stdin, output, terminal: true });
  const controller = new AbortController();
  readline.on("SIGINT", () => controller.abort());
  const ask = (prompt: string) => readline.question(prompt, { signal: controller.signal });
  let connection: ReturnType<typeof connectMemory> | undefined;
  try {
    process.stdout.write(`Chibako Memory setup: ${runtime}/${name}\nAutomatic mode stays off until enabled. Close concurrent host configuration editors.\n`);
    const endpoint = (await ask("Chibako MCP URL: ")).trim();
    process.stdout.write("Restricted Chibako API key (hidden): ");
    hidden = true;
    let key: string;
    try { key = (await ask("")).trim(); }
    finally { hidden = false; process.stdout.write("\n"); }
    connection = connectMemory(endpoint, key);
    const preview = await prepareSetup({ runtime, name, directory, endpoint, key }, connection.call);
    process.stdout.write(JSON.stringify(redactedPreview(preview), null, 2) + "\n");
    process.stdout.write("Host config may contain a private copy of this key. Existing unrelated settings are preserved; Hermes YAML comments/formatting may be normalized.\n");
    if ((await ask("Apply these private configuration changes? [y/N] ")).trim().toLowerCase() !== "y") return { applied: false, enabled: false };
    await applySetup(preview);
    process.stdout.write("Connection configured. Restart/reload the selected host if needed and review its native hook consent.\n");
    process.stdout.write("Optional write check creates one persistent TEST Memory connection checkpoint in the approved area. No automatic deletion.\n");
    if ((await ask("Create that test checkpoint? [y/N] ")).trim().toLowerCase() === "y") {
      const receipt = await writeConnectionCheck(connection.call);
      process.stdout.write(JSON.stringify(receipt) + "\n");
    }
    if ((await ask("Enable automatic session memory (completed temporary checkpoints go to Trash)? [y/N] ")).trim().toLowerCase() === "y") await setEnabled(directory, true, connection.call);
    return localStatus(directory);
  } finally { readline.close(); await connection?.close(); }
}
