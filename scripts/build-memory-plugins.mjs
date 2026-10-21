import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export async function buildMemoryPlugins(output = join(root, "dist/plugins"), { archives = true } = {}) {
  const manifest = JSON.parse(await readFile(join(root, "plugin.json"), "utf8"));
  await mkdir(output, { recursive: true });
  for (const runtime of ["codex", "claude", "hermes"]) {
    const directory = join(output, runtime);
    await rm(directory, { recursive: true, force: true });
    await mkdir(join(directory, "bin"), { recursive: true });
    await build({
      absWorkingDir: root,
      entryPoints: { memory: "scripts/agent-memory.ts", ...(runtime === "hermes" && { "hermes-hook": "integrations/agent-memory/hermes-hook.ts" }) },
      outdir: join(directory, "bin"), outExtension: { ".js": ".mjs" },
      bundle: true, platform: "node", format: "esm", target: "node20",
      banner: { js: 'import { createRequire as __chibakoRequire } from "node:module"; const require = __chibakoRequire(import.meta.url);' },
      logLevel: "silent",
    });
    await cp(join(root, "LICENSE"), join(directory, "LICENSE"));
    await cp(join(root, "integrations/agent-memory/INSTALL.md"), join(directory, "INSTALL.md"));
    await writeFile(join(directory, "mcp.json"), json({ mcpServers: {} }));
    for (const name of ["chibako-memory", "chibako-memory-setup"]) {
      const skillDirectory = join(directory, "skills", name);
      await mkdir(skillDirectory, { recursive: true });
      const content = await readFile(join(root, "skills", name, "SKILL.md"), "utf8");
      const pluginRoot = runtime === "codex" ? '${PLUGIN_ROOT}' : runtime === "claude" ? '${CLAUDE_PLUGIN_ROOT}' : '${CHIBAKO_PLUGIN_ROOT}';
      const instructions = runtime === "hermes" ? "Before showing a command, resolve this installed skill file to its absolute path. Its plugin root is two directories above the skill directory. Show an initial terminal line exporting CHIBAKO_PLUGIN_ROOT to that quoted absolute root, then show the runner command on the next line; do not derive it from the current project.\n\n" : "";
      await writeFile(join(skillDirectory, "SKILL.md"), content
        .replaceAll("{{MEMORY_RUNNER}}", `node "${pluginRoot}/bin/memory.mjs" ${runtime}`)
        .replaceAll("{{RUNTIME}}", runtime) + "\n" + instructions);
    }
    const portable = structuredClone(manifest);
    if (runtime !== "hermes") {
      const variable = runtime === "codex" ? "PLUGIN_ROOT" : "CLAUDE_PLUGIN_ROOT";
      const events = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "PreCompact", ...(runtime === "codex" ? ["Interrupt"] : [])];
      const hooks = { hooks: Object.fromEntries(events.map((event) => [event, [{ hooks: [{ type: "command", command: `node "\${${variable}}/bin/memory.mjs" ${runtime}`, timeout: event === "Interrupt" || event === "PostToolUse" ? 3 : 15 }] }]])) };
      await mkdir(join(directory, "hooks"), { recursive: true });
      await writeFile(join(directory, "hooks/hooks.json"), json(hooks));
      if (runtime === "codex") {
        portable.extensions["com.openai"].hooks = "./hooks/hooks.json";
        await mkdir(join(directory, ".agents/plugins"), { recursive: true });
        const marketplace = JSON.parse(await readFile(join(root, ".agents/plugins/marketplace.json"), "utf8"));
        marketplace.plugins[0].source.path = "./";
        await writeFile(join(directory, ".agents/plugins/marketplace.json"), json(marketplace));
      } else {
        await mkdir(join(directory, ".claude-plugin"), { recursive: true });
        await writeFile(join(directory, ".claude-plugin/plugin.json"), json({ name: manifest.name, version: manifest.version, description: manifest.description, author: manifest.author, license: manifest.license, skills: "./skills/", hooks: "./hooks/hooks.json", mcpServers: {} }));
        await writeFile(join(directory, ".claude-plugin/marketplace.json"), json({ name: "chibako-plugins", owner: manifest.author, plugins: [{ name: manifest.name, source: "./", version: manifest.version }] }));
      }
    } else {
      await writeFile(join(directory, "plugin.yaml"), `name: ${manifest.name}\nversion: "${manifest.version}"\ndescription: Chibako automatic memory\nprovides_hooks:\n  - pre_llm_call\n  - post_tool_call\n  - pre_verify\n  - on_session_end\n  - post_compaction\n  - agent_loop_stopped\n`);
      await cp(join(root, "integrations/agent-memory/hermes-plugin.py"), join(directory, "__init__.py"));
    }
    await writeFile(join(directory, "plugin.json"), json(portable));
    const install = { claude: "/plugin install chibako --marketplace jccd-dev/Chibako", codex: "codex plugin marketplace add jccd-dev/Chibako\ncodex plugin add chibako@chibako-plugins", hermes: "hermes plugins install jccd-dev/Chibako/plugins/hermes" }[runtime];
    await writeFile(join(directory, "README.md"), `# Chibako memory — ${runtime}\n\nInstall:\n\n\`\`\`\n${install}\n\`\`\`\n\nRequires Node.js 20 or newer. Run the bundled chibako-memory-setup skill to configure a private connection. Automatic memory stays disabled until setup is approved. No repository checkout or npm installation is required.\n`);
    if (archives) execFileSync("tar", ["-czf", join(output, `chibako-${runtime}-${manifest.version}.tar.gz`), "-C", directory, "."]);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  // --publish refreshes the committed plugins/ directories that native marketplaces install from.
  if (process.argv[2] === "--publish") await buildMemoryPlugins(join(root, "plugins"), { archives: false });
  else await buildMemoryPlugins(process.argv[2] ? resolve(process.argv[2]) : undefined);
}
