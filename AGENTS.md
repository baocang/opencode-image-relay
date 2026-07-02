# AGENTS.md

Guidance for AI agents (and humans) working on this repository.

## What this is

`opencode-image-relay` is an [OpenCode](https://opencode.ai) plugin that lets
**text-only models** handle pasted images by relaying each image to any
image-capable MCP tool the user has installed. It converts a pasted inline
image into a file path; the model then analyzes that path with an image MCP
tool (e.g. `zai-mcp-server`).

## Architecture invariants — do NOT break these

- **Never hard-code a tool / model / provider name.** The plugin only turns a
  pasted image into a path. Analysis is delegated to whatever image MCP tool
  the model chooses. This keeps the plugin generic.
- **Activation must stay capability-based** (`model.capabilities.input.image`).
  Vision-capable models are passed through untouched — the original image part
  reaches them natively.
- **For text-only models, strip the image `file` part from the outgoing
  request** after saving it. With no unsupported part left, opencode never
  generates its "does not support image input" error, so no system-prompt
  override is needed. The strip is transient (the persisted conversation
  record keeps the original base64), so re-runs re-materialize the temp file.
- **Inject only a minimal hint**: the saved path plus a one-line steer to use
  an image-analysis MCP tool (not the built-in `read`, which fails on images
  for text models). No system prompt, no hard-coded tool/model/provider names.
- **Keep the messages hook idempotent.** Every pass must drop any previously
  injected `[image-relay]` hint and leftover `does not support image input`
  noise before re-injecting, so re-processing never accumulates stale text.

## Commands

```bash
bun install              # install deps
bun run typecheck        # tsc --noEmit
bun test                 # run the test suite
bun run build            # transpile to dist/index.js (optional; opencode loads .ts natively)
```

## Releasing

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. `bun run prepublishOnly` (runs typecheck + tests).
3. `npm publish`.

## Files of interest

- `src/index.ts` — the plugin (default export).
- `tests/index.test.ts` — `bun:test` suite covering the invariants above.
