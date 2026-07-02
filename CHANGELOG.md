# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-07-03

### Added
- Initial release.
- `experimental.chat.messages.transform` hook that saves pasted images to a temp file and injects an absolute path hint, so text-only models can hand them to an image-capable MCP tool.
- `experimental.chat.system.transform` hook that steers the model to analyze the saved path with whatever image MCP tool is available.
- Capability-based activation: vision-capable models are passed through untouched, no config needed.
- LRU eviction of temp images (default 200, configurable via `IMAGE_RELAY_MAX_IMAGES`).
