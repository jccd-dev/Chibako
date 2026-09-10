import { NextRequest } from "next/server";
import { withAuthAny } from "@/lib/api";
import { registerPropertyDef, PropertySchemaError } from "@/lib/properties";

/**
 * Vault-wide property auto-registration, called when a property is created in
 * the note editor with a chosen type. `notes:write` because it happens during
 * normal note editing; `schema:write` keys can also call it.
 */
export const POST = withAuthAny(["notes:write", "schema:write"], async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object" || typeof body.name !== "string") {
    return Response.json({ error: "name is required" }, { status: 400 });
  }
  try {
    const property = registerPropertyDef({
      name: body.name,
      type: typeof body.type === "string" ? body.type : "string",
      options: Array.isArray(body.options) ? body.options.filter((o: unknown): o is string => typeof o === "string") : undefined,
    });
    return Response.json({ property });
  } catch (e) {
    if (e instanceof PropertySchemaError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});