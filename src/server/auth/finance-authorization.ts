import { FinanceError, type FinanceActor, type FinanceScope } from "../../features/finance/types";

export function authorizeFinance(actor: FinanceActor, scope: FinanceScope): void {
  if (actor.kind !== "api-key") return;
  // Finance access is opt-in, including for previously issued wildcard keys.
  if (!actor.id || !actor.scopes.includes(scope)) {
    throw new FinanceError("Forbidden: missing scope", 403, "forbidden");
  }
}

export function authorizeFinanceNotes(actor: FinanceActor): void {
  if (actor.kind === "api-key" && (!actor.id || !(actor.scopes.includes("notes:read") || actor.scopes.includes("*")))) {
    throw new FinanceError("Forbidden: missing notes:read scope", 403, "forbidden");
  }
}

export function financeActorId(actor: FinanceActor): string {
  switch (actor.kind) {
    case "owner": return "owner";
    case "trusted-local": return "trusted-local-mcp";
    case "api-key": return `api-key:${actor.id}`;
  }
}
