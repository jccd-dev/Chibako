import { randomUUID } from "node:crypto";
import { z } from "zod";
import { memoryWriteSchema, retainedMemorySchema, sessionMemorySchema, type MemoryWriteInput, type SessionMemoryInput } from "../../src/features/memory/types";
import { MemoryClientError } from "./client-error";
import type { MemoryCall, Runtime } from "./runtime";

export type SessionMutation = Exclude<SessionMemoryInput, { action: "read" | "continue" }>;
export type SessionContinue = Extract<SessionMemoryInput, { action: "continue" }>;
export const sessionMutationSchema = z.discriminatedUnion("action", [sessionMemorySchema.options[1], sessionMemorySchema.options[2]]);
const checkpointSchema = memoryWriteSchema.pick({ title: true, content: true }).extend({
  expected_revision: memoryWriteSchema.shape.expected_revision.optional(),
  request_id: memoryWriteSchema.shape.request_id.optional(),
  session_id: memoryWriteSchema.shape.session_id.optional(),
  // Old staged payloads may name a task; it no longer controls record identity.
  role: z.enum(["session", "overview"]).optional(), subject: z.string().optional(),
}).strict();
const stageSchema = z.object({
  checkpoint: checkpointSchema.optional(),
  finish: z.object({ expected_revision: memoryWriteSchema.shape.expected_revision.optional(), retain: retainedMemorySchema.optional(), request_id: memoryWriteSchema.shape.request_id.optional() }).strict().optional(),
  now_line: z.string().trim().min(1).max(140).regex(/^[^\r\n[\]]+$/).optional(),
  skip: z.string().trim().min(1).max(300).optional(),
  continue: z.object({ title: memoryWriteSchema.shape.title }).strict().optional(),
  replaces_request_id: z.string().optional(),
}).strict().refine(value => [value.checkpoint, value.finish, value.skip, value.continue].filter(Boolean).length === 1, "Provide exactly one of checkpoint, finish, skip or continue")
  .refine(value => !value.now_line || Boolean(value.checkpoint), "now_line needs a checkpoint");

export async function prepareSessionStage(call: MemoryCall, runtime: Runtime, session_id: string, raw: unknown, legacy?: MemoryWriteInput, scope: { project?: string } = {}): Promise<{
  checkpoint?: SessionMutation | MemoryWriteInput; skip?: string; replaces_request_id?: string; now_line?: string; continue?: SessionContinue;
}> {
  if (legacy) {
    return z.object({ checkpoint: memoryWriteSchema, replaces_request_id: z.string(), now_line: z.string().trim().min(1).max(140).regex(/^[^\r\n[\]]+$/).optional() }).strict()
      .refine(value => !value.now_line || (value.checkpoint.role === "overview" && !/[[\]|]/.test(value.checkpoint.title)), "now_line needs an overview with a plain title").parse(raw);
  }
  const stage = stageSchema.parse(raw);
  if (stage.skip) return { skip: stage.skip, replaces_request_id: stage.replaces_request_id };
  if (stage.continue) {
    return { continue: sessionMemorySchema.options[3].parse({ action: "continue", runtime, session_id, ...scope, request_id: randomUUID(), title: stage.continue.title }) };
  }
  if (stage.checkpoint?.session_id && stage.checkpoint.session_id !== session_id) throw new MemoryClientError("Checkpoint session mismatch");
  const source = stage.checkpoint ?? stage.finish!;
  const candidate = sessionMutationSchema.parse({
    runtime, session_id, ...scope, request_id: source.request_id ?? randomUUID(), expected_revision: source.expected_revision ?? null,
    ...(stage.checkpoint ? { action: "save", title: stage.checkpoint.title, content: stage.checkpoint.content, now_line: stage.now_line ?? "Work in progress" }
      : { action: "finish", ...(stage.finish?.retain ? { retain: stage.finish.retain } : {}) }),
  });
  if (source.expected_revision === undefined) {
    const current = await call("memory_session", { action: "read", runtime, session_id });
    const revision = memoryWriteSchema.shape.expected_revision.parse(current.revision ?? null);
    if (revision && current.note) {
      throw new MemoryClientError(`This session memory already exists at revision ${revision}. Read memory_session with action read, runtime ${runtime} and the hook session_id, merge the current content, then restage with expected_revision ${revision}.`);
    }
    candidate.expected_revision = revision;
  }
  // A finished note's post-finish revision comes only from a read (enforced above when none is given), so this save has merged it.
  if (candidate.action === "save" && candidate.expected_revision) candidate.reopen = true;
  return { checkpoint: candidate, replaces_request_id: stage.replaces_request_id };
}
