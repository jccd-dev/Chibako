import { spawn } from "node:child_process";

const MAX_OUTPUT = 1024 * 1024;

export interface RunResult { code: number; stdout: string; stderr: string }

/** argv-only (never a shell); output and runtime are bounded. */
export function run(command: string, args: string[], options: { timeoutMs?: number; cwd?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 120_000);
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

export async function mustRun(command: string, args: string[], options?: { timeoutMs?: number; cwd?: string }): Promise<string> {
  const result = await run(command, args, options);
  if (result.code !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed (${result.code}): ${result.stderr.trim().slice(0, 300)}`);
  return result.stdout;
}
