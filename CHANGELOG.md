# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-23

### Added
- **Clean Modular Architecture**: Decomposed monolithic codebase into clean, maintainable domain layers (`domain/`, `infra/`, `router/`, `telegram/`, `ui/`, and `usecases/`).
- **Comprehensive Test Suite**: Added 120 automated unit, smoke, router, and resilience tests with 100% pass coverage.
- **Instance Lock Mechanism**: Prevents concurrent duplicate bot instances on the same host using atomic PID file locking.
- **IPv4-First DNS Resolution**: Forces `ipv4first` result order to eliminate 10–15s connection delays to `api.telegram.org` on hosts without native IPv6 routing.
- **Continuous 4s Typing Indicator**: Stable typing heartbeat ensuring Telegram's status indicator remains active throughout long model thinking turns.

### Security
- **Advanced SSRF Protection**: Bitwise 128-bit IPv6 CIDR validation (blocking ULA `fc00::/7`, link-local `fe80::/10`, site-local `fec0::/10`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`), IPv4-mapped IPv6, decimal/hex IP encodings, and DNS pre-resolution.
- **HTTP Redirect Blocking**: Web media fetcher now strictly uses `redirect: "manual"` and rejects 3xx redirects to prevent SSRF bypasses to internal/cloud metadata services.
- **Strict Path Segment Boundary Containment**: Replaced loose string prefix checks with `path.relative` containment (`isWithin`) across workspace, temp, and brain artifact directories.
- **Secret Stripping from Child Env**: Telegram bot token and secrets are scrubbed before spawning AGY child processes.
- **Conversation UUID Validation**: Verifies conversation IDs match standard UUID format before accessing artifact directories.
- **Permission Safety Defaults**: `AGY_ALLOW_DANGEROUSLY_SKIP_PERMISSIONS` now defaults to `false` in code, requiring explicit opt-in via environment configuration.

### Fixed
- **Critical Polling Offset Advancement**: Fixed dynamic offset tracking in the long polling loop to prevent infinite replay loops on commands like `/new`.
- **Telegram Rate-Limit & 429 Resilience**: Added non-blocking error handling and exponential backoff for Telegram API rate limits.
- **Session Header & Response Separation**: Progress header strictly displays step tickers and token usage breakdowns, while final AI responses are sent in a separate clean chat bubble.
- **Timer Race Condition Cleanup**: Background progress update timers are immediately cleared upon job completion, preventing completed summaries from being overwritten by stale progress text.
- **Zero-Loss Auto-Interrupt**: Under `TELEGRAM_AUTO_INTERRUPT`, multiple queued prompts are merged and preserved rather than silently discarded.
- **Document Upload Cleanup**: Uploaded documents are automatically cleaned up in `finally` blocks after processing to prevent disk space accumulation.

## [0.2.0] - 2026-08-21

### Added
- **Configurable progress mode** (`TELEGRAM_PROGRESS_MODE`): `full` (default), `compact` (single-line summary), or `delete` (remove progress message on completion)
- **Configurable verbose levels** (`TELEGRAM_VERBOSE` / `/verbose` command): `detailed`, `compact`, `silent` — controls step-by-step visibility during AGY execution
- **Dynamic model fetching**: bot calls `agy models` on startup and parses available models; falls back to `DEFAULT_MODELS` if unavailable
- **Media auto-delivery**: auto-detect and send images/files referenced in AGY responses
  - Local file paths (markdown image embeds, `file:///` paths)
  - Immich photo previews (requires `IMMICH_URL` + `IMMICH_KEY` env vars)
  - Public web images with SSRF protection (blocks private/loopback IPs)
  - Automatic temp file cleanup after sending
- **Auto-detect & send generated images**: scans conversation artifact directory for images created during the current job turn
- **In-flight job tracking**: persists active jobs to state file; notifies users on restart if their job was interrupted
- **Restart/update notifications**: pending notices are saved to disk and delivered after service restart
- **New commands**: `/update` (git pull + build + restart), `/restart` (service restart), `/learn` (derive rules from conversation), `/verbose` (change verbosity)
- **Atomic default settings persistence**: `persistDefaultSettings` writes to `.env` via temp file + rename to prevent corruption
- **Markdown table rendering**: converts GitHub-flavored markdown tables to aligned monospace codeblocks in Telegram
- **Rich step progress with emojis**: contextual icons for commands, file reads, edits, web searches, URL fetches, file searches, subagents, and thinking steps
- **Typing keepalive**: sends `typing` chat action every 4s during job execution
- **Heartbeat timer**: updates progress message every 2.5s when AGY is idle (no events received)

### Changed
- **`/cancel` enhanced**: now aborts both prompt and custom AGY controllers, with improved cancellation feedback message
- **AbortSignal support**: `runAgy` now accepts and propagates `AbortSignal` for fast cancellation
- **SIGKILL hard termination**: instant process group kill on cancel to prevent stuck processes
- **Session reset preserves settings**: `resetSession` now keeps user settings instead of wiping the entire session
- **Keyboard layout updated**: 3-button persistent keyboard (New session, Model, Verbose toggle)
- **Model selection**: now uses dynamic `getActiveModels()` instead of static `config.agy.allowedModels`
- **Effort auto-detection**: model IDs ending in `-low`/`-medium`/`-high` automatically set the corresponding effort level
- **Link/code formatting**: markdown links are now parsed before inline code tokens to prevent nesting bugs
- **Empty line preservation**: paragraph spacing between blocks is maintained in chunked messages

### Security
- **Hardcoded credentials removed**: Immich API key and private infrastructure URLs are no longer in source code; require explicit env vars
- **SSRF protection**: `isPrivateOrReservedHost()` blocks 127.x, 10.x, 172.16-31, 192.168.x, 169.254.x, 0.x, 100.64-127, ::1, fe80:, fc00:/fd00: for web image fetches
- **`/update` and `/restart` gated**: disabled by default; requires `ALLOW_BOT_UPDATE=true` to enable remote updates/restarts via Telegram
- **Arg-array exec**: `git` and `npm` commands use `execFile` with argument arrays instead of shell strings to prevent injection
- **Memory engine hardcoded path removed**: personal infrastructure path (`/home/ubuntu/dev/agy-memory-engine/`) stripped from source

### Fixed
- **German strings replaced with English**: all user-facing messages standardized to English
- **Dead code removed**: `defaults.dangerouslySkipPermissions` was set but never used (final settings always override to `false`)
- **`/models` command removed** (replaced by `/model` with dynamic fetching)
- **Shared quota detection**: `parseUsageQuota` now consolidates identical Gemini and Claude/GPT quotas into a unified "Antigravity Quota (All Models)" display

## [0.1.8] - 2026-08-17

### Added
- Auto-record Telegram sessions to conversation database
- Implement missing slash commands
- Fix resume menu HTML escaping

### Fixed
- Process tree cleanup on cancellation

## [0.1.7] - 2026-08-15

### Added
- Full-control mode as default
- Interactive setup wizard

## [0.1.6] - 2026-08-12

### Added
- Gemini 3.7 Flash High model
- Multimodal photo and document file attachment support
- Active context progress bar visualization
- Document download handlers

### Fixed
- Queue `isDraining` lock guard to prevent job processing race conditions

## [0.1.5] - 2026-08-10

### Fixed
- Cancel command keeps Telegram polling responsive
- Stop custom AGY commands on cancel

## [0.1.4] - 2026-08-09

### Added
- Interactive usage credits and resume
- Complete AGY CLI controls exposure
- npm package and release workflows

## [0.1.3] - 2026-08-08

### Fixed
- Format AGY responses for Telegram
- Align CI with Node 22 package runtime

## [0.1.2] - 2026-08-07

### Added
- Standalone AGY Telegram gateway
- TypeScript migration

[0.3.0]: https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/compare/v0.1.8...v0.2.0
[0.1.8]: https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/releases/tag/v0.1.4
