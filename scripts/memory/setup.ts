import { MemoryClientError } from "./client-error";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { digest } from "./host-config";
import { readProfile, saveProfile, pendingCount, type MemoryProfile } from "./profile";
import { privateDirectory, readOptional, atomicPrivateWrite, withPrivateLock } from "./private-files";
import { validateEndpoint, validateMemoryStatus, type MemoryStatus } from "./connection";
import type { MemoryCall } from "./runtime";
import type { HostAdapter } from "./host-adapter";

export interface SetupInput {
  host: HostAdapter; name: string; directory: string; endpoint: string; key: string;
  hostFile?: string;
}
export interface SetupPreview {
  input: SetupInput; previous: MemoryProfile | null; original: string | null;
  hostFile: string; rendered: { text: string; digest: string }; status: MemoryStatus;
}
export async function inspectConnection(call: MemoryCall, expected?: { principal_id: string; area: string }): Promise<MemoryStatus> {
  const status = validateMemoryStatus(await call("memory_status", {}));
  if (expected && (status.principal_id !== expected.principal_id || status.area !== expected.area)) throw new MemoryClientError("Connection identity or memory area changed; run setup before retrying pending work.");
  await call("get_knowledge_schema", {});
  await call("recall", { query: "project handoff", limit: 1, budget: 100 });
  return status;
}
export async function prepareSetup(input: SetupInput, call: MemoryCall): Promise<SetupPreview> {
  if (process.platform === "win32") throw new MemoryClientError("Windows private storage is not supported yet.");
  const endpoint = validateEndpoint(input.endpoint);
  const previous = await readProfile(input.directory);
  const { host } = input;
  if (previous && previous.runtime !== host.runtime) throw new MemoryClientError("Selected profile belongs to another runtime.");
  const status = await inspectConnection(call);
  if (previous && (previous.endpoint !== endpoint || previous.principal_id !== status.principal_id) && await pendingCount(input.directory)) {
    throw new MemoryClientError("Pending checkpoints belong to the previous connection. Keep that profile and create a different profile instead.");
  }
  const hostFile = input.hostFile || host.configPath();
  if (!path.isAbsolute(hostFile)) throw new MemoryClientError("Host configuration path must be absolute.");
  if (previous && previous.host.file !== hostFile) throw new MemoryClientError("Host target changed; use a separate profile.");
  const duplicates = await host.duplicateHookFiles(hostFile);
  if (duplicates.length) throw new MemoryClientError(`Existing manual memory hooks need review before setup: ${duplicates.join(", ")}`);
  const original = await readOptional(hostFile);
  const rendered = host.renderConfig(original, endpoint, input.key, previous || undefined);
  await host.validateConfig?.(rendered.text);
  return { input: { ...input, endpoint }, previous, original, hostFile, rendered, status };
}

export async function applySetup(preview: SetupPreview): Promise<MemoryProfile> {
  const { input, status, hostFile, original, rendered } = preview;
  await privateDirectory(input.directory);
  return withPrivateLock(path.join(input.directory, "profile.lock"), async () => {
    const current = await readProfile(input.directory);
    if (JSON.stringify(current) !== JSON.stringify(preview.previous)) throw new MemoryClientError("Profile changed during setup. Run setup again.");
    if (current && (current.endpoint !== input.endpoint || current.principal_id !== status.principal_id) && await pendingCount(input.directory)) throw new MemoryClientError("Pending checkpoints prevent changing connection.");
    await mkdir(path.dirname(hostFile), { recursive: true, mode: 0o700 });
    return withPrivateLock(`${hostFile}.chibako-memory.lock`, async () => {
      if (await readOptional(hostFile) !== original) throw new MemoryClientError("Host configuration changed during setup. Run setup again.");
      const profile: MemoryProfile = {
        version: 1, runtime: input.host.runtime, name: input.name, endpoint: input.endpoint, api_key: input.key,
        principal_id: status.principal_id, area: status.area!, enabled: false,
        connected_at: new Date().toISOString(), host: { file: hostFile, digest: rendered.digest },
      };
      await atomicPrivateWrite(hostFile, rendered.text);
      try { await saveProfile(input.directory, profile); }
      catch (error) {
        if (await readOptional(hostFile) !== rendered.text) throw new MemoryClientError("Setup failed and host config changed concurrently; automatic rollback was refused. Review the selected host configuration.");
        if (original === null) await unlink(hostFile);
        else await atomicPrivateWrite(hostFile, original);
        throw error;
      }
      return profile;
    });
  });
}
export async function setEnabled(host: HostAdapter, directory: string, enabled: boolean, call?: MemoryCall): Promise<void> {
  await privateDirectory(directory);
  await withPrivateLock(path.join(directory, "profile.lock"), async () => {
    const profile = await readProfile(directory);
    if (!profile?.api_key) throw new MemoryClientError("Run setup before enabling automatic memory.");
    if (enabled) {
      if (!call) throw new MemoryClientError("Resume requires a verified connection.");
      if (profile.runtime !== host.runtime) throw new MemoryClientError("Selected profile belongs to another runtime.");
      host.renderConfig(await readOptional(profile.host.file), profile.endpoint, profile.api_key, profile);
      await inspectConnection(call, profile);
      profile.connected_at = new Date().toISOString();
    }
    await saveProfile(directory, { ...profile, enabled });
  });
}
export async function disconnect(host: HostAdapter, directory: string): Promise<void> {
  await privateDirectory(directory);
  await withPrivateLock(path.join(directory, "profile.lock"), async () => {
    const profile = await readProfile(directory);
    if (!profile) return;
    if (profile.runtime !== host.runtime) throw new MemoryClientError("Selected profile belongs to another runtime.");
    await saveProfile(directory, { ...profile, enabled: false });
    if (!profile.api_key) return;
    await withPrivateLock(`${profile.host.file}.chibako-memory.lock`, async () => {
      const original = await readOptional(profile.host.file);
      const rendered = host.renderConfig(original, profile.endpoint, profile.api_key, profile, true);
      if (await readOptional(profile.host.file) !== original) throw new MemoryClientError("Host config changed; profile is paused. Review it before disconnecting.");
      await atomicPrivateWrite(profile.host.file, rendered.text);
      try { await saveProfile(directory, { ...profile, enabled: false, api_key: "", host: { ...profile.host, digest: "" } }); }
      catch (error) {
        if (await readOptional(profile.host.file) === rendered.text && original !== null) await atomicPrivateWrite(profile.host.file, original);
        throw error;
      }
    });
  });
}
export async function writeConnectionCheck(call: MemoryCall): Promise<object> {
  const id = randomUUID();
  const receipt = z.object({ saved: z.literal(true), request_id: z.string(), note_id: z.string().min(1), revision: z.string().regex(/^[a-f0-9]{64}$/) }).parse(
    await call("memory_write", { request_id: id, role: "session", subject: "setup-check", session_id: `setup-${id}`, title: `TEST Memory connection ${id.slice(0, 8)}`, content: "Explicitly approved plugin setup check. No project work or deployment is implied.", expected_revision: null }),
  );
  if (receipt.request_id !== id) throw new MemoryClientError("Setup checkpoint receipt does not match; saving is unverified.");
  return receipt;
}
export function redactedPreview(preview: SetupPreview): object {
  return { runtime: preview.input.host.runtime, profile: preview.input.name, endpoint: preview.input.endpoint,
    area: preview.status.area, scopes: preview.status.scopes, host_file: preview.hostFile,
    private_profile: path.join(preview.input.directory, "profile.json"), credentials: "hidden; private files (0600)",
    host_config_changed: digest(preview.original || "") !== digest(preview.rendered.text),
    automatic_memory: "off until enabled; native hook trust required", capture_verified: false,
    hermes_limit: preview.input.host.setupLimit };
}
