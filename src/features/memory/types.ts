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

export class MemoryError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}
