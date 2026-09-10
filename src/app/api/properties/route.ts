import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { getPropertyDefs, setPropertyDefs, PropertySchemaError } from "@/lib/properties";

export const GET = withAuth("schema:read", async () => {
  return Response.json({ properties: getPropertyDefs() });
});

export const PUT = withAuth("schema:write", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  try {
    const properties = setPropertyDefs(body.properties);
    return Response.json({ properties });
  } catch (e) {
    if (e instanceof PropertySchemaError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
