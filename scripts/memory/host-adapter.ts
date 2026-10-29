import type { HookInput, MemoryResult, Runtime } from "./runtime";
import type { MemoryProfile } from "./profile";

/**
 * One host integration: its native hook contract and configuration rules.
 * Each package bundles exactly one adapter; shared code receives it as an argument.
 */
export interface HostAdapter {
  runtime: Runtime;
  /** Host home that holds Chibako private profiles; setup and native hooks must agree on it. */
  home(): string;
  configPath(): string;
  renderConfig(original: string | null, endpoint: string, key: string, previous?: MemoryProfile, remove?: boolean): { text: string; digest: string };
  validateConfig?(text: string): Promise<void>;
  duplicateHookFiles(hostFile: string): Promise<string[]>;
  /** Validates a native hook payload and maps it onto the engine lifecycle. */
  hookInput(payload: unknown): HookInput;
  /** Encodes an engine result for this host; undefined writes nothing. */
  hookOutput(input: HookInput, result: MemoryResult): Record<string, unknown> | undefined;
  hookFailure(message: string): Record<string, unknown>;
  /** Also deliver due checkpoint requests in prompt context, for hosts whose turn-end continuation is limited. */
  promptRequests?: boolean;
  setupLimit?: string;
}
