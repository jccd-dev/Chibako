import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";

// OpenAI-compatible fake Embedding Provider on localhost, shared by the Embedding index tests.

export type Handler = (res: ServerResponse, inputs: number, texts?: string[]) => void;

export const ok: Handler = (res, inputs) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: Array.from({ length: inputs }, () => ({ embedding: [1, 0, 0, 0, 0, 0, 0, 0] })) }));
};
export const refuse: Handler = (res) => void res.writeHead(429, { "retry-after": "12", "x-ratelimit-remaining-requests": "0" }).end("rate limited");

export const TEST_KEY = "TEST-secret-key";

/** Runs fn against the fake Provider with the Embedding env pointed at it. `sizes` lists the Notes in each request, in order. */
export async function withProvider(handler: Handler, fn: (state: { sizes: number[] }) => Promise<void>, env: Record<string, string> = {}) {
  const state = { sizes: [] as number[] };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const texts = JSON.parse(body).input as string[];
      state.sizes.push(texts.length);
      handler(res, texts.length, texts);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const saved = { ...process.env };
  Object.assign(process.env, {
    CHIBAKO_EMBEDDING_PROVIDER: "openai",
    CHIBAKO_EMBEDDING_API_KEY: TEST_KEY,
    CHIBAKO_EMBEDDING_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    CHIBAKO_EMBEDDING_MODEL: "TEST-model",
    CHIBAKO_EMBEDDING_DIM: "8",
    ...env,
  });
  try {
    await fn(state);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    server.closeAllConnections();
    server.close();
  }
}
