import { z } from "zod";
import { createAccountSchema, getAccountSchema } from "./types";

export const noteIdsSchema = z.array(getAccountSchema.shape.id).max(20)
  .refine(ids => new Set(ids).size === ids.length, "Note links must be unique")
  .transform(ids => ids.slice().sort());
export const setActivityNoteLinksSchema = z.object({
  request_id: createAccountSchema.shape.request_id,
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  note_ids: noteIdsSchema,
}).strict();
export const getActivityNoteLinksSchema = getAccountSchema;
export const financeNoteChoicesSchema = z.object({
  q: z.string().trim().max(200).default(""),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
}).strict();
export interface FinanceNoteChoice { id: string; title: string }
export interface ActivityNoteLinks { id: string; version: number; notes: FinanceNoteChoice[] }
export interface FinanceNoteChoices { notes: FinanceNoteChoice[]; total: number; limit: number; offset: number }
