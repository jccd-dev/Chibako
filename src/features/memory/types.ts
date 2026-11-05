import { z } from "zod";

const identity = z.string().trim().min(1).max(200);
// One safe folder segment under the memory area; hooks derive it from the session's repository.
export const projectSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
export const memoryWriteSchema = z.object({
  project: projectSchema.optional(),
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
export const memoryReadSchema = memoryWriteSchema.pick({ project: true, role: true, subject: true, session_id: true });

const sessionIdentity = z.object({
  runtime: z.enum(["codex", "claude", "hermes"]), session_id: identity, project: projectSchema.optional(),
  // A runtime-side hash of the host thread; sessions sharing it resume one checkpoint.
  thread_key: z.string().regex(/^[a-f0-9]{64}$/).optional().describe("all actions: optional 64-hex hash of the host thread; sessions in one thread share its checkpoint"),
  workstream: z.boolean().optional().describe("opt in to plain checkpoint titles and automatic workstream joins; thread_key also opts in"),
});
export const retainedMemorySchema = memoryWriteSchema.omit({ request_id: true, session_id: true }).extend({
  role: z.enum(["wiki", "preference"]),
  // Defaults to the session's project; null files cross-project knowledge at the area root.
  project: projectSchema.nullable().optional(),
});
// Metadata only, never content: the server formats the Activity line from these validated fields.
const count = z.number().int().min(0).max(1_000_000);
// Repo-relative paths only: no absolute, drive, parent or Markdown-breaking characters.
export const activityFileSchema = z.string().regex(/^(?![/\\]|[A-Za-z]:)(?!(?:.*\/)?\.\.(?:\/|$))[^\x00-\x1f\x7f`[\]|\\]{1,300}$/);
export const activityEntrySchema = z.object({
  branch: z.string().regex(/^[\w./+@-]{1,120}$/).optional(),
  head: z.string().regex(/^[a-f0-9]{7,40}$/).optional(),
  files: z.array(activityFileSchema).max(10).default([]),
  files_changed: count.default(0), tool_calls: count, user_turns: count,
}).strict();
const nowLine = z.string().trim().min(1).max(140).regex(/^[^\r\n[\]]+$/);
export const sessionMemorySchema = z.discriminatedUnion("action", [
  sessionIdentity.extend({ action: z.literal("read") }).strict(),
  sessionIdentity.extend({
    action: z.literal("save"), request_id: identity,
    title: memoryWriteSchema.shape.title.refine((value) => !/[[\]|]/.test(value), "Title cannot contain [, ] or |"),
    content: memoryWriteSchema.shape.content,
    // Omitted means a new checkpoint; an existing one still conflicts.
    expected_revision: memoryWriteSchema.shape.expected_revision.default(null),
    now_line: nowLine,
    // Required to save into a finished (kept) checkpoint, after reading and merging it.
    reopen: z.literal(true).optional(),
  }).strict(),
  sessionIdentity.extend({
    action: z.literal("finish"), request_id: identity,
    expected_revision: memoryWriteSchema.shape.expected_revision.default(null),
    retain: retainedMemorySchema.optional(),
  }).strict(),
  // Joins another session's active or finished checkpoint by its title; both sessions then share it.
  sessionIdentity.extend({
    action: z.literal("continue"), request_id: identity,
    title: memoryWriteSchema.shape.title,
  }).strict(),
  // Records a metadata-only line in the project's Activity note; never edits a checkpoint.
  sessionIdentity.extend({ action: z.literal("activity"), request_id: identity, entry: activityEntrySchema }).strict(),
]);
export type SessionMemoryInput = z.infer<typeof sessionMemorySchema>;
// MCP discovery serializes a discriminated union as an empty schema, so tools/list advertises this flat
// contract instead; sessionMemorySchema stays authoritative for each action (no defaults applied here).
export const sessionMemoryToolSchema = sessionIdentity.extend({
  action: z.enum(sessionMemorySchema.options.map((option) => option.shape.action.value)),
  request_id: identity.optional().describe("save, finish, continue, activity: stable per operation; reuse it only to retry the same body"),
  title: memoryWriteSchema.shape.title.optional().describe("save: checkpoint title; continue: the existing checkpoint to join"),
  content: memoryWriteSchema.shape.content.optional().describe("save: full checkpoint content"),
  now_line: nowLine.optional().describe("save: one-line next action for Agent Now"),
  expected_revision: memoryWriteSchema.shape.expected_revision.optional()
    .describe("save, finish: null or omitted for a new checkpoint, otherwise the revision from action read"),
  reopen: z.literal(true).optional().describe("save: required to save into a finished checkpoint after reading and merging it"),
  retain: retainedMemorySchema.optional().describe("finish: optional wiki/preference knowledge to retain"),
  entry: activityEntrySchema.optional().describe("activity: metadata only (branch, head, up to 10 repo-relative files, counts); hooks send it"),
}).strict();

// memory_save input. Content keeps the legacy 200k cap for observation rows; a Fact note is limited again by memoryWriteSchema.
export const factSaveSchema = z.object({
  content: z.string().max(200_000),
  note_id: z.string().max(200_000).optional(),
  source: z.string().max(200_000).optional(),
  title: memoryWriteSchema.shape.title.refine((value) => !/[[\]|]/.test(value), "Title cannot contain [, ] or |").optional(),
  project: projectSchema.optional(),
}).strict();
export type FactSaveInput = z.infer<typeof factSaveSchema>;

export class MemoryError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}
