# Chibako memory — codex

Install:

```
codex plugin marketplace add jccd-dev/Chibako
codex plugin add chibako@chibako-plugins

# In an interactive Codex session, open /hooks and review/trust Chibako's hooks.
# Installing the plugin and approving memory setup do not grant hook trust.
# After updates, review any hooks marked modified before relying on capture.
```

Requires Node.js 20 or newer. Run the bundled chibako-memory-setup skill to configure a private connection. Automatic memory stays disabled until setup is approved. No repository checkout or npm installation is required.
