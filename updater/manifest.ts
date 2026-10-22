import { releaseManifestSchema, RELEASE_MANIFEST_URL, type ReleaseManifest } from "../src/features/updates/protocol";

const ALLOWED_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
const MAX_BYTES = 64 * 1024;

/** Fetches the latest release manifest from the fixed release source and validates it strictly. */
export async function fetchManifest(url = RELEASE_MANIFEST_URL): Promise<ReleaseManifest> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "follow", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Release check failed (${response.status}).`);
  if (!ALLOWED_HOSTS.has(new URL(response.url).hostname)) throw new Error("Release manifest came from an unexpected host.");
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error("Release manifest is too large.");
  return releaseManifestSchema.parse(JSON.parse(text));
}
