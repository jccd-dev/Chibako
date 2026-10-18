# Browser automation preferences

- Prefer the product-native T3 preview tools for browser work: call `preview_status` first, then `preview_open` if no automation-capable preview is attached, and use snapshot-provided locators over coordinates. Confidence: 0.9
- Reuse the user's existing authenticated preview tab/session (e.g., the parent's tab) instead of starting a fresh browser session. Confidence: 0.8
- If T3 preview MCP tools are absent in an ACP environment, use the `T3_ACP_MCP_NODE` / `acp-mcp-call` fallback for preview tools. Fall back to external Playwright only when the T3 preview is absent or explicitly unsupported. Confidence: 0.85
- When preview tools are confirmed working, use them directly; do not probe shell environment variables (e.g., `env | grep T3_ACP`) to discover MCP/T3 availability. Confidence: 0.75
