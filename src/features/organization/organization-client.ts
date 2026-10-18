import { z } from "zod";

const resultInput = z.object({ note: z.object({ id: z.string().min(1) }).optional() });
const errorInput = z.object({ error: z.string() });

export function notifyOrganizationChanged(): void {
  window.dispatchEvent(new Event("chibako:notes-changed"));
  window.dispatchEvent(new Event("chibako:organized"));
}

export async function requestOrganizationChange(url: string, method: string, body?: object, quiet = false) {
  const saves: Promise<void>[] = [];
  window.dispatchEvent(new CustomEvent("chibako:before-organize", { detail: saves }));
  await Promise.all(saves);
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = errorInput.safeParse(data);
    throw new Error(error.success ? error.data.error : "Could not save changes.");
  }
  const result = resultInput.parse(data);
  if (!quiet) notifyOrganizationChanged();
  return result;
}
