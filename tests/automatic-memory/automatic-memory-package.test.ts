import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { load } from "js-yaml";

const root = process.cwd();

test("memory packages run outside checkout without dependencies or configured credentials", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "chibako-package-"));
  try {
    const output = path.join(temporary, "artifacts");
    execFileSync(process.execPath, [path.join(root, "scripts/build-memory-plugins.mjs"), output], { cwd: temporary });
    const artifacts = await readdir(output);
    for (const runtime of ["codex", "claude", "hermes"]) {
      const extracted = path.join(temporary, `${runtime} installed`);
      await mkdir(extracted);
      const archive = artifacts.find((name) => name.startsWith(`chibako-${runtime}-`) && name.endsWith(".tar.gz"));
      assert.ok(archive);
      execFileSync("tar", ["-xzf", path.join(output, archive), "-C", extracted]);
      const environment = {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        HOME: temporary,
        HERMES_HOME: path.join(temporary, "hermes-home"),
        CODEX_HOME: path.join(temporary, "codex-home"),
        CHIBAKO_MEMORY_STATE_DIR: path.join(temporary, runtime, "state"),
        CHIBAKO_MEMORY_ENABLED: "0",
      } satisfies NodeJS.ProcessEnv;
      const runner = path.join(extracted, "bin/memory.mjs");
      const invoke = (args: string[], input = "") => execFileSync(process.execPath, args, { cwd: temporary, env: environment, input, encoding: "utf8" });
      assert.deepEqual(JSON.parse(invoke([runner, runtime], "not JSON")), {});
      const status = invoke([runner, runtime, "status", "--profile", "default"]);
      assert.equal(JSON.parse(status).configured, false);
      assert.equal(JSON.parse(status).enabled, false);
      assert.doesNotMatch(status, /Bearer|https?:\/\//);
      const manifest = JSON.parse(await readFile(path.join(extracted, "plugin.json"), "utf8"));
      assert.equal(manifest.name, "chibako");
      assert.deepEqual(JSON.parse(await readFile(path.join(extracted, "mcp.json"), "utf8")), { mcpServers: {} });
      const skill = await readFile(path.join(extracted, "skills/chibako-memory-setup/SKILL.md"), "utf8");
      assert.doesNotMatch(skill, /\{\{MEMORY_RUNNER\}\}|\{\{RUNTIME\}\}/);
      const cleanup = await readFile(path.join(extracted, "skills/chibako-memory-cleanup/SKILL.md"), "utf8");
      const header = cleanup.match(/^---\n([\s\S]*?)\n---/);
      assert.ok(header);
      const frontmatter = load(header[1]);
      assert.ok(frontmatter && typeof frontmatter === "object" && "disable-model-invocation" in frontmatter);
      assert.equal(frontmatter["disable-model-invocation"], true);
      const policy = await readFile(path.join(extracted, "skills/chibako-memory-cleanup/agents/openai.yaml"), "utf8");
      assert.deepEqual(load(policy), { policy: { allow_implicit_invocation: false } });
      if (runtime === "hermes") {
        const native = await readFile(path.join(extracted, "plugin.yaml"), "utf8");
        assert.match(native, /provides_hooks:\n  - pre_llm_call/);
        assert.deepEqual(JSON.parse(invoke([path.join(extracted, "bin/hermes-hook.mjs")], "not JSON")), {});
        const python = `import importlib.util
spec=importlib.util.spec_from_file_location('plugin', ${JSON.stringify(path.join(extracted, "__init__.py"))})
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Context:
 def __init__(self): self.hooks={}; self.skills={}
 def register_hook(self,name,fn): self.hooks[name]=fn
 def register_skill(self,name,value): self.skills[name]=value
c=Context()
m.register(c)
assert len(c.hooks)==6
assert set(c.skills)=={'chibako-memory', 'chibako-memory-setup', 'chibako-memory-cleanup'}
assert all(p.exists() for p in c.skills.values())
assert c.hooks['pre_llm_call'](session_id='fixture', user_message='hello', conversation_history=['private transcript']) == {}
assert c.hooks['agent_loop_stopped'](session_key='opaque-route') is None
calls=[]
def fake_run(*args, **kwargs):
 calls.append(kwargs)
 return type('Result', (), {'returncode':0, 'stdout':'{\"context\":\"briefing\"}'})()
m.subprocess.run=fake_run
assert c.hooks['pre_llm_call'](session_id='fixture', turn_id='turn', user_message='hello', conversation_history=['private transcript']) == {'context':'briefing'}
assert m.json.loads(calls[0]['input']) == {'hook_event_name':'pre_llm_call', 'session_id':'fixture', 'extra':{'turn_id':'turn', 'user_message':'hello'}}
assert calls[0]['env']['PLUGIN_ROOT'] == str(m._PLUGIN_ROOT)
`;
        execFileSync("python3", ["-c", python], { cwd: temporary, env: environment });
      } else {
        const hooks = JSON.parse(await readFile(path.join(extracted, "hooks/hooks.json"), "utf8"));
        for (const entries of Object.values(hooks.hooks)) {
          assert.match(JSON.stringify(entries), /bin\/memory\.mjs/);
          assert.doesNotMatch(JSON.stringify(entries), /tsx|scripts\/agent-memory/);
        }
        if (runtime === "codex") {
          assert.equal(manifest.extensions["com.openai"].hooks, "./hooks/hooks.json");
          await readFile(path.join(extracted, ".agents/plugins/marketplace.json"));
        } else {
          const native = JSON.parse(await readFile(path.join(extracted, ".claude-plugin/plugin.json"), "utf8"));
          assert.equal(native.hooks, "./hooks/hooks.json");
          assert.deepEqual(native.mcpServers, {});
        }
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

// plugins/ is rebuilt and released by .github/workflows/plugin-release.yml after merge, so PRs may leave it stale.
test("committed marketplace plugins share one version and point at plugins/", async () => {
  const { version } = JSON.parse(await readFile(path.join(root, "plugin.json"), "utf8"));
  for (const runtime of ["claude", "codex", "hermes"]) {
    const published = JSON.parse(await readFile(path.join(root, "plugins", runtime, "plugin.json"), "utf8"));
    assert.equal(published.version, version, `plugins/${runtime} is not released at ${version}`);
  }
  const claudePlugin = JSON.parse(await readFile(path.join(root, "plugins/claude/.claude-plugin/plugin.json"), "utf8"));
  assert.equal(claudePlugin.version, version);
  const claude = JSON.parse(await readFile(path.join(root, ".claude-plugin/marketplace.json"), "utf8"));
  assert.equal(claude.plugins[0].source, "./plugins/claude");
  assert.equal(claude.plugins[0].version, version);
  const codex = JSON.parse(await readFile(path.join(root, ".agents/plugins/marketplace.json"), "utf8"));
  assert.equal(codex.plugins[0].source.path, "./plugins/codex");
  const bundled = JSON.parse(await readFile(path.join(root, "plugins/codex/.agents/plugins/marketplace.json"), "utf8"));
  assert.equal(bundled.plugins[0].source.path, "./");
});

test("plugin releases bump patch by default and minor on request", async () => {
  const { bumpVersion } = await import(path.join(root, "scripts/release-memory-plugins.mjs"));
  assert.equal(bumpVersion("0.4.0", "patch"), "0.4.1");
  assert.equal(bumpVersion("0.4.9", "minor"), "0.5.0");
  assert.throws(() => bumpVersion("0.4.0", "major"));
  assert.throws(() => bumpVersion("v0.4", "patch"));
});
