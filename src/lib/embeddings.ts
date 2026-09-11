import { createHash } from "node:crypto";
import { stripFrontmatter } from "./markdown";

// ---------- embedding provider seam ----------
//
// Embeddings are optional. This module owns env config and the Provider
// abstraction; it never imports notes or the DB, so it stays cycle-free and
// trivially testable. Staleness is decided by hashing the Embedding input
// (CONTEXT.md), so a Provider that produces identical vectors for identical
// text is enough for the freshness tests.

/** Bump when the composition of `embeddingInput` changes, to force a re-embed. */
export const INPUT_VERSION = 1;

const FAKE_DIM = 64;

export interface EmbeddableNote {
  title: string;
  content: string;
}

export interface EmbeddingProvider {
  /** Provider family, e.g. "fake" | "openai" | "openrouter". */
  id: string;
  /** Model id stored on every embedding row. */
  model: string;
  /** Vector dimensions; 0 means the provider decides per request. */
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** The exact text (title + body, frontmatter excluded) used to embed and to detect staleness. */
export function embeddingInput(note: EmbeddableNote): string {
  return `${note.title}\n\n${stripFrontmatter(note.content)}`;
}

export function inputHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function baseUrl(): string {
  const explicit = env("CHIBAKO_EMBEDDING_BASE_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  if (env("CHIBAKO_EMBEDDING_PROVIDER") === "openrouter") return "https://openrouter.ai/api/v1";
  return "https://api.openai.com/v1";
}

/** OpenAI-compatible `/v1/embeddings` call. */
async function openaiEmbed(texts: string[], model: string, dim: number): Promise<number[][]> {
  const body: Record<string, unknown> = { model, input: texts };
  if (dim > 0) body.dimensions = dim;
  const res = await fetch(`${baseUrl()}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env("CHIBAKO_EMBEDDING_API_KEY")}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`embedding request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

/** Small synonym map so the fake provider has *some* semantic reach beyond exact tokens. */
const FAKE_SYNONYMS: Record<string, string> = {
  blastoff: "launch",
  lift: "launch",
  ignite: "ignition",
  rocket: "launch",
};

/** Deterministic bag-of-words hashing vector — enough to exercise freshness/plumbing offline. */
function fakeEmbedOne(text: string): number[] {
  const v = new Array<number>(FAKE_DIM).fill(0);
  for (const raw of text.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff]+/)) {
    if (!raw) continue;
    const token = FAKE_SYNONYMS[raw] ?? raw;
    const h = createHash("sha256").update(token).digest();
    const idx = ((h[0] << 8) | h[1]) % FAKE_DIM;
    v[idx] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/**
 * The active Provider, or null when embeddings are disabled. Config is read
 * lazily so tests (and the app) can toggle it via env.
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const provider = env("CHIBAKO_EMBEDDING_PROVIDER");
  if (!provider) return null;
  if (provider === "fake") {
    return {
      id: "fake",
      model: env("CHIBAKO_EMBEDDING_MODEL") || "fake-embedding",
      dim: FAKE_DIM,
      embed: async (texts) => texts.map(fakeEmbedOne),
    };
  }
  const key = env("CHIBAKO_EMBEDDING_API_KEY");
  if (!key) return null;
  const model = env("CHIBAKO_EMBEDDING_MODEL") || "text-embedding-3-small";
  const dim = Number(env("CHIBAKO_EMBEDDING_DIM") || 0);
  return {
    id: provider,
    model,
    dim,
    embed: (texts) => openaiEmbed(texts, model, dim),
  };
}

export function embeddingsEnabled(): boolean {
  return getEmbeddingProvider() !== null;
}
