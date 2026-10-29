import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { manualHook, object, setServer } from "../host-config";
import { readOptional } from "../private-files";
import type { HostAdapter } from "../host-adapter";

const hookSchema = z.object({
  session_id: z.string().min(1).max(200),
  hook_event_name: z.enum(["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "PreCompact"]),
  cwd: z.string().max(4096).optional(), turn_id: z.string().optional(), prompt: z.string().optional(), stop_hook_active: z.boolean().optional(),
});

export const claude: HostAdapter = {
  runtime: "claude",
  home: () => process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"),
  configPath: () => path.join(process.env.CLAUDE_CONFIG_DIR || homedir(), ".claude.json"),
  renderConfig(original, endpoint, key, previous, remove = false) {
    const data = object(original ? JSON.parse(original) : {});
    const digest = setServer(data, "mcpServers", { type: "http", url: endpoint, headers: { Authorization: `Bearer ${key}` } }, previous, remove);
    return { text: JSON.stringify(data, null, 2) + "\n", digest };
  },
  async duplicateHookFiles(hostFile) {
    const matches: string[] = [];
    for (const file of new Set([path.join(path.dirname(hostFile), ".claude/settings.json"), path.resolve(".claude/settings.json"), path.resolve(".claude/settings.local.json")])) {
      const content = await readOptional(file);
      if (content && manualHook.test(content)) matches.push(file);
    }
    return matches;
  },
  hookInput: (payload) => hookSchema.parse(payload),
  hookOutput(input, { context, request, warning }) {
    return {
      ...(request ? { decision: "block", reason: request } : {}),
      ...(context ? { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: context } } : {}),
      ...(warning ? { systemMessage: warning } : {}),
    };
  },
  hookFailure: (message) => ({ systemMessage: message }),
};
