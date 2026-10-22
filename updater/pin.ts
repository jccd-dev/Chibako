import fs from "node:fs";
import { assertRegularFile, writeFileAtomic } from "./files";
import { DIGEST, IMAGE_REPOSITORY } from "../src/features/updates/protocol";

/** The pin is one KEY=value line in a dotenv file, shared with whatever deploys the stack. */
const ROLLBACK_TAG = /^chibako-rollback:[0-9a-f-]{36}$/;

export function isValidPin(value: string): boolean {
  const [repo, digest] = value.split("@");
  return (repo === IMAGE_REPOSITORY && DIGEST.test(digest ?? "")) || ROLLBACK_TAG.test(value);
}

export function readPin(file: string, key: string): string | null {
  if (!fs.existsSync(file)) return null;
  assertRegularFile(file);
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1).trim();
  }
  return null;
}

/** Replaces only the pin line, preserving every other line and the file mode. */
export function writePin(file: string, key: string, value: string): void {
  if (!isValidPin(value)) throw new Error("Refusing to pin an unexpected image reference");
  let lines: string[] = [];
  let mode = 0o600;
  if (fs.existsSync(file)) {
    assertRegularFile(file);
    mode = fs.statSync(file).mode & 0o777;
    lines = fs.readFileSync(file, "utf8").split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
  }
  const next = `${key}=${value}`;
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) lines[index] = next; else lines.push(next);
  writeFileAtomic(file, `${lines.join("\n")}\n`, mode);
}
