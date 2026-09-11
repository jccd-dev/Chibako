import assert from 'node:assert/strict';
import { test } from 'node:test';

test('embedding input is title plus frontmatter-stripped body', async () => {
  const { embeddingInput, inputHash } = await import('../src/lib/embeddings');
  const input = embeddingInput({ title: 'Rocket', content: '---\nstatus: draft\n---\nignition' });
  assert.equal(input, 'Rocket\n\nignition');
  assert.equal(inputHash(input), inputHash('Rocket\n\nignition'));
  assert.notEqual(inputHash(input), inputHash('Rocket\n\nignition sequence'));
});

test('fake provider is enabled without an API key and returns a deterministic vector', async () => {
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'fake';
  delete process.env.CHIBAKO_EMBEDDING_API_KEY;
  const { embeddingsEnabled, getEmbeddingProvider } = await import('../src/lib/embeddings');
  assert.equal(embeddingsEnabled(), true);
  const p = getEmbeddingProvider();
  assert(p, 'fake provider exists');
  assert.equal(p!.id, 'fake');
  const [a] = await p!.embed(['ignition launch']);
  const [b] = await p!.embed(['ignition launch']);
  assert.equal(a.length, p!.dim);
  assert(a.some((x) => x !== 0), 'non-zero vector');
  assert.deepEqual(a, b, 'deterministic for same input');
});

test('provider is null and disabled when unset', async () => {
  process.env.CHIBAKO_EMBEDDING_PROVIDER = '';
  delete process.env.CHIBAKO_EMBEDDING_API_KEY;
  const { embeddingsEnabled, getEmbeddingProvider } = await import('../src/lib/embeddings');
  assert.equal(embeddingsEnabled(), false);
  assert.equal(getEmbeddingProvider(), null);
});
