"""Native Hermes callbacks; payloads stay bounded to the shared memory contract."""
import json
import os
from pathlib import Path
import subprocess

_PLUGIN_ROOT = Path(__file__).resolve().parent


def _callback(event):
    def handle(**kwargs):
        session_id = kwargs.get("session_id")
        if not isinstance(session_id, str) or not session_id:
            return None
        extra = {}
        for key in ("user_message", "turn_id"):
            if isinstance(kwargs.get(key), str):
                extra[key] = kwargs[key]
        payload = json.dumps({"hook_event_name": event, "session_id": session_id, "extra": extra})
        if len(payload.encode("utf-8")) > 300000:
            return None
        environment = os.environ.copy()
        environment["PLUGIN_ROOT"] = str(_PLUGIN_ROOT)
        environment.setdefault("HERMES_HOME", str(Path.home() / ".hermes"))
        try:
            result = subprocess.run(
                ["node", str(_PLUGIN_ROOT / "bin" / "hermes-hook.mjs")],
                input=payload, text=True, capture_output=True, timeout=15,
                env=environment, check=False,
            )
            if result.returncode:
                return {"context": "Automatic memory failed; run Chibako memory doctor."} if event == "pre_llm_call" else None
            output = json.loads(result.stdout)
            return output if event in ("pre_llm_call", "pre_verify") and isinstance(output, dict) else None
        except (OSError, subprocess.TimeoutExpired, ValueError):
            return {"context": "Automatic memory unavailable; run Chibako memory doctor."} if event == "pre_llm_call" else None
    return handle


def register(ctx):
    for event in ("pre_llm_call", "post_tool_call", "pre_verify", "on_session_end", "post_compaction", "agent_loop_stopped"):
        ctx.register_hook(event, _callback(event))
    for name in ("chibako-memory", "chibako-memory-setup"):
        ctx.register_skill(name, _PLUGIN_ROOT / "skills" / name / "SKILL.md")
