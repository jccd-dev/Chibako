import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { authenticateApiKey } from "../server/auth/api-key-authorization";
import { createMcpServer } from "./create-server";

const configuredKey = process.env.CHIBAKO_API_KEY;
const principal = configuredKey ? authenticateApiKey(configuredKey) : null;
const scopes = configuredKey ? principal?.scopes ?? [] : null;
const server = createMcpServer({ scopes, exposure: "local" });

await server.connect(new StdioServerTransport());
process.stdin.resume();
