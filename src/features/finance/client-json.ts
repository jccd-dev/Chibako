export class FinanceClientError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
  }
}

export async function financeJson<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FinanceClientError("Could not load finance. Try again.");
  }
  const payload = body as { error?: string; code?: unknown };
  if (!response.ok) throw new FinanceClientError(
    payload.error || "Could not load finance. Try again.",
    typeof payload.code === "string" ? payload.code : undefined,
  );
  return body as T;
}
