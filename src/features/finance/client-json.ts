export async function financeJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load finance. Try again.");
  return body;
}
