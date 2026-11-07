import { z } from "zod";
import { createAccountSchema } from "./types";
import { calendarDateSchema } from "./activity-types";

export const confirmStatementSchema = z.object({
  request_id: createAccountSchema.shape.request_id,
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
  statement_date: calendarDateSchema,
  balance: createAccountSchema.shape.maintaining_balance.removeDefault(),
  minimum_due: createAccountSchema.shape.maintaining_balance.removeDefault(),
  due_date: calendarDateSchema,
}).strict().refine(value => value.due_date >= value.statement_date, "Due date cannot precede statement date");

