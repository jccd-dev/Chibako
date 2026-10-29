import { MemoryClientError } from "../client-error";
import { homedir } from "node:os";
import path from "node:path";
import { load, dump } from "js-yaml";
import { z } from "zod";
import { manualHook, object, setServer } from "../host-config";
import { readOptional } from "../private-files";
import type { HostAdapter } from "../host-adapter";

// Hermes callbacks arrive as a bounded envelope from the bundled Python plugin.
const hookSchema = z.object({
  session_id: z.string().min(1).max(200),
  hook_event_name: z.enum(["pre_llm_call", "post_tool_call", "pre_verify", "on_session_end", "post_compaction", "agent_loop_stopped"]),
  extra: z.object({ user_message: z.string().optional(), turn_id: z.string().optional() }).passthrough().optional(),
}).passthrough();
const lifecycle = { pre_llm_call: "UserPromptSubmit", post_tool_call: "PostToolUse", pre_verify: "Stop" } as const;

export const hermes: HostAdapter = {
  runtime: "hermes",
  home: () => process.env.HERMES_HOME || path.join(homedir(), ".hermes"),
  configPath() {
    const home = process.env.HERMES_HOME;
    if (!home) throw new MemoryClientError("Run setup inside the selected Hermes profile with HERMES_HOME set; no gateway/profile is guessed.");
    return path.join(home, "config.yaml");
  },
  renderConfig(original, endpoint, key, previous, remove = false) {
    const data = object(original ? load(original) : {});
    const digest = setServer(data, "mcp_servers", { url: endpoint, headers: { Authorization: `Bearer ${key}` } }, previous, remove);
    return { text: dump(data, { lineWidth: -1, noRefs: true }), digest };
  },
  async duplicateHookFiles(hostFile) {
    const content = await readOptional(hostFile);
    return content && manualHook.test(content) ? [hostFile] : [];
  },
  hookInput(payload) {
    const input = hookSchema.parse(payload);
    return {
      session_id: input.session_id,
      hook_event_name: input.hook_event_name in lifecycle ? lifecycle[input.hook_event_name as keyof typeof lifecycle] : "PreCompact",
      ...(input.extra?.turn_id ? { turn_id: input.extra.turn_id } : {}),
      ...(input.extra?.user_message ? { prompt: input.extra.user_message } : {}),
    };
  },
  // pre_verify continues the loop with the request; pre_llm_call injects context; other events only log.
  hookOutput(input, { context, request, warning }) {
    if (input.hook_event_name === "Stop" && request) return { action: "continue", message: request };
    if (input.hook_event_name === "UserPromptSubmit") return { context: [context, warning].filter(Boolean).join("\n") };
    if (warning) process.stderr.write(warning + "\n");
    return undefined;
  },
  hookFailure: (message) => ({ context: message }),
  promptRequests: true,
  setupLimit: "Missing-checkpoint continuation only for coding; actual gateway and both client routes unverified.",
};
