import { MemoryClientError } from "./client-error";
import { createHash } from "node:crypto";
import path from "node:path";
import { homedir } from "node:os";
import { load, dump } from "js-yaml";
import { z } from "zod";
import type { Runtime } from "./runtime";
import type { MemoryProfile } from "./profile";

const serverName = "chibako-memory";
const begin = "# BEGIN CHIBAKO MEMORY MANAGED CONNECTION";
const end = "# END CHIBAKO MEMORY MANAGED CONNECTION";
export const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
export function hostConfigPath(runtime: Runtime): string {
  if (runtime === "codex") return path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "config.toml");
  if (runtime === "claude") return path.join(process.env.CLAUDE_CONFIG_DIR || homedir(), ".claude.json");
  const home = process.env.HERMES_HOME;
  if (!home) throw new MemoryClientError("Run setup inside the selected Hermes profile with HERMES_HOME set; no gateway/profile is guessed.");
  return path.join(home, "config.yaml");
}
function object(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(value);
}
function assertOwned(current: string | null, previous?: MemoryProfile): void {
  if (current !== null && (!previous || digest(current) !== previous.host.digest)) throw new MemoryClientError("The chibako-memory connection already exists or was changed outside setup. Review it before replacing/removing it.");
  if (current === null && previous?.host.digest) throw new MemoryClientError("Managed connection was removed outside setup; review it before reconfiguring.");
}
export function renderHostConfig(runtime: Runtime, original: string | null, endpoint: string, key: string, previous?: MemoryProfile, remove = false): { text: string; digest: string } {
  if (runtime === "codex") {
    const source = original || "";
    const start = source.indexOf(begin);
    const stop = source.indexOf(end);
    let current: string | null = null;
    if (start >= 0 || stop >= 0) {
      if (start < 0 || stop < start || source.indexOf(begin, start + begin.length) >= 0 || source.indexOf(end, stop + end.length) >= 0) throw new MemoryClientError("Malformed managed connection markers.");
      current = source.slice(start, stop + end.length);
    }
    const unrelated = current ? source.replace(current, "") : source;
    if (/^\s*\[\s*mcp_servers\.(?:chibako-memory|"chibako-memory"|'chibako-memory')(?:\s*\]|\.)/m.test(unrelated)) throw new MemoryClientError("An unmanaged chibako-memory TOML connection exists.");
    assertOwned(current, previous);
    const connection = remove ? "" : `${begin}\n[mcp_servers.chibako-memory]\nurl = ${JSON.stringify(endpoint)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${key}`)} }\n${end}`;
    return { text: current ? source.replace(current, connection) : `${source}${source && !source.endsWith("\n") ? "\n" : ""}\n${connection}\n`, digest: digest(connection) };
  }
  const data = object(original ? runtime === "hermes" ? load(original) : JSON.parse(original) : {});
  const field = runtime === "hermes" ? "mcp_servers" : "mcpServers";
  const servers = data[field] === undefined ? {} : { ...object(data[field]) };
  const current = servers[serverName] === undefined ? null : JSON.stringify(servers[serverName]);
  assertOwned(current, previous);
  const connection = { ...(runtime === "claude" ? { type: "http" } : {}), url: endpoint, headers: { Authorization: `Bearer ${key}` } };
  if (remove) delete servers[serverName];
  else servers[serverName] = connection;
  data[field] = servers;
  return { text: runtime === "hermes" ? dump(data, { lineWidth: -1, noRefs: true }) : JSON.stringify(data, null, 2) + "\n", digest: digest(JSON.stringify(connection)) };
}
