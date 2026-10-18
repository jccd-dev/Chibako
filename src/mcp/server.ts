import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { authenticateApiKey } from "../server/auth/api-key-authorization";
import { createMcpServer } from "./create-server";

const configuredKey = process.env.CHIBAKO_API_KEY;
const principal = configuredKey !== undefined ? authenticateApiKey(configuredKey) : null;
const scopes = configuredKey !== undefined ? principal?.scopes ?? [] : null;
const financeActor = configuredKey === undefined
  ? { kind: "trusted-local" as const }
  : principal ? { kind: "api-key" as const, id: principal.id, scopes: principal.scopes } : undefined;
const server = createMcpServer({ scopes, exposure: "local", financeActor });

await server.connect(new StdioServerTransport());
process.stdin.resume();
