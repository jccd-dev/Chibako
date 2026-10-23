import { z } from "zod";

/**
 * Contract shared by the app and the companion updater. Everything crossing
 * the request/status channel is untrusted by the reader, so it is validated on
 * both sides; the app can only ask for a version, never supply a target.
 */

export const IMAGE_REPOSITORY = "ghcr.io/jccd-dev/chibako";
export const UPDATER_REPOSITORY = "ghcr.io/jccd-dev/chibako-updater";
export const RELEASE_MANIFEST_URL = "https://github.com/jccd-dev/chibako/releases/latest/download/release.json";
/** Bump when the request/status/state contract changes incompatibly; installers re-provision the updater. */
export const UPDATER_PROTOCOL = 1;
export const MAX_REQUEST_BYTES = 512;
export const STATUS_STALE_MS = 120_000;

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const versionSchema = z.string().max(32).regex(VERSION);
const digestSchema = z.string().regex(DIGEST);

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}

export const updateRequestSchema = z.object({
  v: z.literal(1),
  id: z.string().regex(UUID),
  action: z.literal("update"),
  version: versionSchema,
}).strict();
export type UpdateRequest = z.infer<typeof updateRequestSchema>;

/** Asks the updater to refetch the release manifest now; never installs. Companions without it drop the file unread. */
export const checkRequestSchema = z.object({
  v: z.literal(1),
  id: z.string().regex(UUID),
  action: z.literal("check"),
}).strict();
export const inboxRequestSchema = z.union([updateRequestSchema, checkRequestSchema]);

export const REQUEST_FILE = /^request-[0-9a-f-]{36}\.json$/;

/** Published beside every release (release.json); fetched by the updater only. */
export const releaseManifestSchema = z.object({
  schema: z.literal(1),
  version: versionSchema,
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  image: z.literal(IMAGE_REPOSITORY),
  digest: digestSchema,
  updater: z.object({ image: z.literal(UPDATER_REPOSITORY), digest: digestSchema }).strict(),
  minUpdaterProtocol: z.number().int().min(1).max(1000),
  publishedAt: z.string().max(40),
  notes: z.string().max(4000),
  url: z.string().max(300).regex(/^https:\/\/github\.com\/jccd-dev\/chibako\/releases\/tag\/v[0-9.]+$/),
}).strict();
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export const OPERATION_PHASES = [
  "pulling", "quiescing", "snapshotting", "switching", "starting", "validating", "rolling_back",
  "succeeded", "rolled_back", "needs_attention", "failed",
] as const;
export type OperationPhase = (typeof OPERATION_PHASES)[number];
export const TERMINAL_PHASES: readonly OperationPhase[] = ["succeeded", "rolled_back", "needs_attention", "failed"];

export const statusSchema = z.object({
  v: z.literal(1),
  protocol: z.number().int(),
  heartbeatAt: z.number().int(),
  checkedAt: z.number().int().nullable(),
  currentVersion: versionSchema.nullable(),
  latest: z.object({
    version: versionSchema,
    notes: z.string().max(4000),
    publishedAt: z.string().max(40),
    url: z.string().max(300),
  }).nullable(),
  checkError: z.string().max(300).nullable(),
  /** Id of the last manual check the updater finished; absent from companions that predate manual checks. */
  checkAck: z.string().regex(UUID).nullable().optional(),
  operation: z.object({
    id: z.string().regex(UUID),
    phase: z.enum(OPERATION_PHASES),
    from: versionSchema.nullable(),
    to: versionSchema,
    updatedAt: z.number().int(),
    error: z.string().max(500).nullable(),
  }).nullable(),
}).strict();
export type UpdaterStatus = z.infer<typeof statusSchema>;

/** What the app returns to the browser. */
export interface UpdateView {
  state: "unmanaged" | "unavailable" | "current" | "available" | "updating";
  currentVersion: string | null;
  latest: { version: string; notes: string; publishedAt: string; url: string } | null;
  operation: { id: string; phase: OperationPhase; to: string; error: string | null; updatedAt: number } | null;
  message: string | null;
  /** Last finished manual check request id, so the browser can tell its own check completed. */
  checkAck: string | null;
}
