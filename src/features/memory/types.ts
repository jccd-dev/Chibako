import { z } from "zod";

const identity = z.string().trim().min(1).max(200);
export const memoryWriteSchema = z.object({
  request_id: identity,
  role: z.enum(["session", "wiki", "preference", "overview"]),
  subject: identity,
  session_id: identity,
  title: z.string().trim().min(1).max(120).regex(/^[^/\\\x00-\x1f]+$/),
  content: z.string().min(1).max(64_000),
  expected_revision: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  confirmation: z.object({ source: identity, scope: identity }).strict().optional(),
}).strict();
export type MemoryWriteInput = z.infer<typeof memoryWriteSchema>;
export const memoryReadSchema = memoryWriteSchema.pick({ role: true, subject: true, session_id: true });

const sessionIdentity = z.object({ runtime: z.enum(["codex", "claude", "hermes"]), session_id: identity });
export const retainedMemorySchema = memoryWriteSchema.omit({ request_id: true, session_id: true }).extend({
  role: z.enum(["wiki", "preference"]),
});
export const sessionMemorySchema = z.discriminatedUnion("action", [
  sessionIdentity.extend({ action: z.literal("read") }).strict(),
  sessionIdentity.extend({
    action: z.literal("save"), request_id: identity,
    title: memoryWriteSchema.shape.title.refine((value) => !/[[\]|]/.test(value), "Title cannot contain [, ] or |"),
    content: memoryWriteSchema.shape.content,
    expected_revision: memoryWriteSchema.shape.expected_revision,
    now_line: z.string().trim().min(1).max(140).regex(/^[^\r\n[\]]+$/),
  }).strict(),
  sessionIdentity.extend({
    action: z.literal("finish"), request_id: identity,
    expected_revision: memoryWriteSchema.shape.expected_revision,
    retain: retainedMemorySchema.optional(),
  }).strict(),
]);
export type SessionMemoryInput = z.infer<typeof sessionMemorySchema>;

export class MemoryError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}
