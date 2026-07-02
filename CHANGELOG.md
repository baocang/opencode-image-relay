# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.3] - 2026-07-03

### Changed
- Hint text switched to English and simplified to a positive steer (dropped the "don't use read" clause): "Analyze with an available image-analysis tool (MCP)."

## [0.0.2] - 2026-07-03

### Changed
- Strip the image part from the outgoing message (after saving it) so opencode never generates its "does not support image input" error — no system-prompt override needed anymore.
- Removed the injected system prompt entirely; `system.transform` now only detects image capability.
- The message hint now carries just the saved path plus a one-line steer to use an image-analysis MCP tool (not the built-in `read`).

## [0.0.1] - 2026-07-03

### Added
- Initial release.
- `experimental.chat.messages.transform` hook that saves pasted images to a temp file and injects an absolute path hint, so text-only models can hand them to an image-capable MCP tool.
- `experimental.chat.system.transform` hook that steers the model to analyze the saved path with whatever image MCP tool is available.
- Capability-based activation: vision-capable models are passed through untouched, no config needed.
- LRU eviction of temp images (default 200, configurable via `IMAGE_RELAY_MAX_IMAGES`).
