import { mustRun, run } from "./exec";
import type { UpdaterConfig } from "./config";
import { IMAGE_REPOSITORY } from "../src/features/updates/protocol";

const VERSION_LABEL = "org.opencontainers.image.version";

export interface RunningImage { version: string | null; pin: string | null }

/** The only place Docker is invoked: fixed subcommands, argv only, target from host config. */
export class Docker {
  constructor(private config: UpdaterConfig, private sleep: (ms: number) => Promise<void>) {}

  private compose(...args: string[]): string[] {
    const c = this.config;
    return ["compose", "-p", c.projectName, "--project-directory", c.projectDir,
      ...c.envFiles.flatMap((file) => ["--env-file", file]),
      ...c.composeFiles.flatMap((file) => ["-f", file]), ...args];
  }

  /** The image Compose would actually run for the service, after merging every file and env file. */
  async resolvedImage(): Promise<string | null> {
    const out = await mustRun("docker", this.compose("config", "--format", "json"));
    const parsed = JSON.parse(out) as { services?: Record<string, { image?: string }> };
    return parsed.services?.[this.config.service]?.image ?? null;
  }

  /** Fails unless Compose takes the service image from the pin, so a pin change really changes what runs. */
  async assertResolvedImage(expected: string): Promise<void> {
    const image = await this.resolvedImage();
    if (image !== expected) throw new Error(`Compose resolves ${this.config.service} to ${image ?? "no image"}, not the ${this.config.pinVar} pin ${expected}; check the env-file order and the image setting.`);
  }

  /** Pull the selected digest itself; compose pull would fetch whatever the old pin still names. */
  async pull(ref: string): Promise<void> {
    await mustRun("docker", ["pull", "--quiet", ref], { timeoutMs: 15 * 60_000 });
  }

  async imageVersion(ref: string): Promise<string | null> {
    const out = await mustRun("docker", ["image", "inspect", "--format", `{{index .Config.Labels "${VERSION_LABEL}"}}`, ref]);
    return out.trim() || null;
  }

  async stop(): Promise<void> {
    await mustRun("docker", this.compose("stop", "-t", "30", this.config.service), { timeoutMs: 120_000 });
  }

  async up(): Promise<void> {
    await mustRun("docker", this.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", this.config.service), { timeoutMs: 120_000 });
  }

  private async containerId(): Promise<string | null> {
    const out = await mustRun("docker", this.compose("ps", "-a", "-q", this.config.service));
    return out.split("\n")[0].trim() || null;
  }

  /** Version label plus a pin that can recreate the running image exactly (tagging it locally if it has no digest). */
  async runningImage(tagForRollback?: string): Promise<RunningImage | null> {
    const id = await this.containerId();
    if (!id) return null;
    const inspected = (await mustRun("docker", ["inspect", "--format", `{{.Image}}|{{index .Config.Labels "${VERSION_LABEL}"}}`, id])).trim();
    const [imageId, version] = inspected.split("|");
    const digests = (await mustRun("docker", ["image", "inspect", "--format", "{{range .RepoDigests}}{{println .}}{{end}}", imageId])).split("\n");
    const fromRegistry = digests.map((line) => line.trim()).find((line) => line.startsWith(`${IMAGE_REPOSITORY}@`));
    let pin = fromRegistry ?? null;
    if (!pin && tagForRollback) {
      await mustRun("docker", ["tag", imageId, tagForRollback]);
      pin = tagForRollback;
    }
    return { version: version || null, pin };
  }

  /** Waits until the service container runs the expected image and reports healthy. */
  async waitHealthy(expectedRef: string): Promise<void> {
    const deadline = Date.now() + this.config.healthTimeoutSeconds * 1000;
    let lastState = "no container";
    while (Date.now() < deadline) {
      const id = await this.containerId();
      if (id) {
        const result = await run("docker", ["inspect", "--format", "{{.Config.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", id]);
        if (result.code === 0) {
          const [image, status, health] = result.stdout.trim().split("|");
          lastState = `${status}/${health}`;
          if (image !== expectedRef) throw new Error(`Container runs ${image}, expected ${expectedRef}`);
          if (health === "healthy") return;
          if (health === "unhealthy" || status === "exited" || status === "dead") throw new Error(`The new version did not become healthy (${lastState}).`);
        }
      }
      await this.sleep(2000);
    }
    throw new Error(`Timed out waiting for the new version to become healthy (${lastState}).`);
  }
}
