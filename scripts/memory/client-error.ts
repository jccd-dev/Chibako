// Allowlisted, content-free failure details; raw upstream messages never enter this shape.
export const failureCategories = ["conflict", "ineligible", "request_conflict", "timeout", "authentication", "http", "connection", "denied", "unsupported", "invalid_receipt", "unknown"] as const;
export type MemoryFailure = { category: typeof failureCategories[number]; phase?: "connect" | "call"; http_status?: number; elapsed_ms?: number };
/** Messages from this class are safe to show; remote payloads and parser errors are not. */
export class MemoryClientError extends Error {
  constructor(message: string, readonly failure?: MemoryFailure) { super(message); }
}
