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
- **Do not strip the original inline `file` part.** It is the source of truth
  and lets the hook re-materialize the temp file on demand from the persisted
  base64 (the temp file is ephemeral; the conversation record is not).
- **Keep both hooks idempotent.** Every pass must clean up previously-injected
  `[image-relay]` hints and opencode's `does not support image input` error
  noise, then re-inject.

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
