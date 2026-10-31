import { MemoryClientError } from "../client-error";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { assertOwned, digest, manualHook } from "../host-config";
import { atomicPrivateWrite, readOptional } from "../private-files";
import type { HostAdapter } from "../host-adapter";

const begin = "# BEGIN CHIBAKO MEMORY MANAGED CONNECTION";
const end = "# END CHIBAKO MEMORY MANAGED CONNECTION";
const home = () => process.env.CODEX_HOME || path.join(homedir(), ".codex");
const hookSchema = z.object({
  session_id: z.string().min(1).max(200),
  hook_event_name: z.enum(["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "PreCompact", "Interrupt"]),
  cwd: z.string().max(4096).optional(), turn_id: z.string().optional(), prompt: z.string().optional(), stop_hook_active: z.boolean().optional(),
});

export const codex: HostAdapter = {
  runtime: "codex",
  promptRequests: true,
  home,
  configPath: () => path.join(home(), "config.toml"),
  renderConfig(original, endpoint, key, previous, remove = false) {
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
  },
  async validateConfig(text) {
    const temporary = await mkdtemp(path.join(tmpdir(), "chibako-config-check-"));
    try {
      await atomicPrivateWrite(path.join(temporary, "config.toml"), text);
      try {
        await promisify(execFile)("codex", ["mcp", "get", "chibako-memory", "--json"], {
          env: { ...process.env, CODEX_HOME: temporary }, timeout: 5000, maxBuffer: 1_000_000,
        });
      } catch { throw new MemoryClientError("Codex configuration validation failed. Install a supported Codex CLI and resolve existing TOML conflicts before applying setup."); }
    } finally { await rm(temporary, { recursive: true, force: true }); }
  },
  async duplicateHookFiles(hostFile) {
    const matches: string[] = [];
    for (const file of new Set([path.join(path.dirname(hostFile), "hooks.json"), path.resolve(".codex/hooks.json"), hostFile])) {
      const content = await readOptional(file);
      if (content && manualHook.test(content)) matches.push(file);
    }
    return matches;
  },
  hookInput: (payload) => hookSchema.parse(payload),
  hookOutput(input, { context, warning }) {
    return {
      ...(context && ["SessionStart", "UserPromptSubmit", "PostToolUse"].includes(input.hook_event_name)
        ? { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: context } } : {}),
      ...(warning ? { systemMessage: warning } : {}),
    };
  },
  hookFailure: (message) => ({ systemMessage: message }),
};
