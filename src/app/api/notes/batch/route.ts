import { withAuthAny } from "@/lib/api";
import { hasScope } from "@/server/auth/api-key-authorization";
import { noteBatchInput, organizeNotes } from "@/features/organization/note-batch";

export const POST = withAuthAny(["notes:write", "notes:purge"], async (req, scopes) => {
  const parsed = noteBatchInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Provide an action and a non-empty selection of unique Notes." }, { status: 400 });
  const required = parsed.data.action === "purge" ? "notes:purge" : "notes:write";
  if (!hasScope(scopes, required)) return Response.json({ error: "Forbidden: missing scope" }, { status: 403 });
  organizeNotes(parsed.data);
  return Response.json({ ok: true });
});
