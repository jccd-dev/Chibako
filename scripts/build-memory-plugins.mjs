import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const versionsFile = join(root, "plugin-versions.json");

// Native hook declarations shared by the Claude Code and Codex hook schema; each target picks its own events.
function nativeHooks(runtime, variable, events) {
  return { hooks: Object.fromEntries(events.map((event) => [event, [{ hooks: [{ type: "command", command: `node "\${${variable}}/bin/memory.mjs" ${runtime}`, timeout: event === "Interrupt" || event === "PostToolUse" ? 3 : 15 }] }]])) };
}

// One owner per host: bundle entries, plugin-root variable, native metadata and install command.
// Adding a host means adding an entry here, a scripts/memory/<host>/ adapter and a version.
export const targets = {
  codex: {
    entries: { memory: "scripts/memory/codex/main.ts" },
    pluginRoot: "${PLUGIN_ROOT}",
    install: "codex plugin marketplace add jccd-dev/Chibako\ncodex plugin add chibako@chibako-plugins\n\n# In an interactive Codex session, open /hooks and review/trust Chibako's hooks.\n# Installing the plugin and approving memory setup do not grant hook trust.\n# After updates, review any hooks marked modified before relying on capture.",
    instructions: "Codex requires separate hook consent. After installation, open /hooks in an interactive Codex session and review/trust Chibako's hooks. Repeat review when an update marks them modified. Approving memory setup configures the connection; it does not trust hooks. Do not bypass hook trust during normal setup.\n\n",
    async native(directory, manifest, version) {
      await mkdir(join(directory, "hooks"), { recursive: true });
      await writeFile(join(directory, "hooks/hooks.json"), json(nativeHooks("codex", "PLUGIN_ROOT", ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "PreCompact", "Interrupt"])));
      await mkdir(join(directory, ".codex-plugin"), { recursive: true });
      await writeFile(join(directory, ".codex-plugin/plugin.json"), json({
        ...manifest, version, skills: "./skills/", hooks: "./hooks/hooks.json",
        interface: manifest.extensions["com.openai"].interface, $schema: undefined, extensions: undefined,
      }));
      await mkdir(join(directory, ".agents/plugins"), { recursive: true });
      const marketplace = JSON.parse(await readFile(join(root, ".agents/plugins/marketplace.json"), "utf8"));
      marketplace.plugins[0].source.path = "./";
      await writeFile(join(directory, ".agents/plugins/marketplace.json"), json(marketplace));
      // A portable root manifest takes precedence and silently loses bundled hooks in Codex 0.164.0.
      await writeFile(join(directory, "plugin.json"), json({ name: manifest.name, version }));
    },
  },
  claude: {
    entries: { memory: "scripts/memory/claude/main.ts" },
    pluginRoot: "${CLAUDE_PLUGIN_ROOT}",
    install: "/plugin install chibako --marketplace jccd-dev/Chibako",
    async native(directory, manifest, version) {
      await mkdir(join(directory, "hooks"), { recursive: true });
      await writeFile(join(directory, "hooks/hooks.json"), json(nativeHooks("claude", "CLAUDE_PLUGIN_ROOT", ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "PreCompact"])));
      await mkdir(join(directory, ".claude-plugin"), { recursive: true });
      await writeFile(join(directory, ".claude-plugin/plugin.json"), json({ name: manifest.name, version, description: manifest.description, author: manifest.author, license: manifest.license, skills: "./skills/", hooks: "./hooks/hooks.json", mcpServers: {} }));
      await writeFile(join(directory, ".claude-plugin/marketplace.json"), json({ name: "chibako-plugins", owner: manifest.author, plugins: [{ name: manifest.name, source: "./", version }] }));
      await writeFile(join(directory, "plugin.json"), json({ ...manifest, version }));
    },
  },
  hermes: {
    entries: { memory: "scripts/memory/hermes/main.ts", "hermes-hook": "integrations/agent-memory/hermes-hook.ts" },
    pluginRoot: "${CHIBAKO_PLUGIN_ROOT}",
    install: "hermes plugins install jccd-dev/Chibako/plugins/hermes",
    instructions: "Before showing a command, resolve this installed skill file to its absolute path. Its plugin root is two directories above the skill directory. Show an initial terminal line exporting CHIBAKO_PLUGIN_ROOT to that quoted absolute root, then show the runner command on the next line; do not derive it from the current project.\n\n",
    async native(directory, manifest, version) {
      await writeFile(join(directory, "plugin.yaml"), `name: ${manifest.name}\nversion: "${version}"\ndescription: Chibako automatic memory\nprovides_hooks:\n  - pre_llm_call\n  - post_tool_call\n  - pre_verify\n  - on_session_end\n  - post_compaction\n  - agent_loop_stopped\n`);
      await cp(join(root, "integrations/agent-memory/hermes-plugin.py"), join(directory, "__init__.py"));
      await writeFile(join(directory, "plugin.json"), json({ ...manifest, version }));
    },
  },
};
export const targetNames = Object.keys(targets);

export async function readVersions() {
  return JSON.parse(await readFile(versionsFile, "utf8"));
}

async function buildTarget(runtime, directory, manifest, version) {
  const target = targets[runtime];
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(directory, "bin"), { recursive: true });
  await build({
    absWorkingDir: root, entryPoints: target.entries,
    outdir: join(directory, "bin"), outExtension: { ".js": ".mjs" },
    bundle: true, platform: "node", format: "esm", target: "node20",
    banner: { js: 'import { createRequire as __chibakoRequire } from "node:module"; const require = __chibakoRequire(import.meta.url);' },
    logLevel: "silent",
  });
  await cp(join(root, "LICENSE"), join(directory, "LICENSE"));
  await cp(join(root, "integrations/agent-memory/INSTALL.md"), join(directory, "INSTALL.md"));
  await writeFile(join(directory, "mcp.json"), json({ mcpServers: {} }));
  for (const name of ["chibako-memory", "chibako-memory-setup", "chibako-memory-cleanup"]) {
    const skillDirectory = join(directory, "skills", name);
    await mkdir(skillDirectory, { recursive: true });
    await cp(join(root, "skills", name), skillDirectory, { recursive: true });
    const content = await readFile(join(root, "skills", name, "SKILL.md"), "utf8");
    await writeFile(join(skillDirectory, "SKILL.md"), content
      .replaceAll("{{MEMORY_RUNNER}}", `node "${target.pluginRoot}/bin/memory.mjs" ${runtime}`)
      .replaceAll("{{RUNTIME}}", runtime) + "\n" + (target.instructions ?? ""));
  }
  await target.native(directory, manifest, version);
  await writeFile(join(directory, "README.md"), `# Chibako memory — ${runtime}\n\nInstall:\n\n\`\`\`\n${target.install}\n\`\`\`\n\nRequires Node.js 20 or newer. Run the bundled chibako-memory-setup skill to configure a private connection. Automatic memory stays disabled until setup is approved. No repository checkout or npm installation is required.\n`);
}

/** Builds the selected targets, each at its own version from plugin-versions.json. */
export async function buildMemoryPlugins(output = join(root, "dist/plugins"), { archives = true, only = targetNames } = {}) {
  const manifest = JSON.parse(await readFile(join(root, "plugin.json"), "utf8"));
  const versions = await readVersions();
  await mkdir(output, { recursive: true });
  for (const runtime of only) {
    if (!targets[runtime]) throw new Error(`Unknown plugin target: ${runtime}`);
    if (!/^\d+\.\d+\.\d+$/.test(versions[runtime] ?? "")) throw new Error(`Missing ${runtime} version in plugin-versions.json`);
    const directory = join(output, runtime);
    await buildTarget(runtime, directory, manifest, versions[runtime]);
    if (archives) execFileSync("tar", ["-czf", join(output, `chibako-${runtime}-${versions[runtime]}.tar.gz`), "-C", directory, "."]);
  }
}

// Refreshes the committed plugins/<target> directories that native marketplaces install from.
export async function publishMemoryPlugins(only = targetNames) {
  await buildMemoryPlugins(join(root, "plugins"), { archives: false, only });
  if (!only.includes("claude")) return;
  const path = join(root, ".claude-plugin/marketplace.json");
  const marketplace = JSON.parse(await readFile(path, "utf8"));
  marketplace.plugins[0].version = (await readVersions()).claude;
  await writeFile(path, json(marketplace));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [first, second] = process.argv.slice(2);
  const only = (value) => !value || value === "all" ? targetNames : [value];
  if (first === "--publish") await publishMemoryPlugins(only(second));
  else await buildMemoryPlugins(first ? resolve(first) : undefined, { only: only(second) });
}
