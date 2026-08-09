<div align="center">

# Antigravity CLI Telegram Bot

**Connect Antigravity CLI to Telegram with a secure, allowlisted bot gateway.**

Run AGY prompts from Telegram with allowlisted users, per-chat sessions,
streamed progress, model controls, and a hardened systemd deployment.

[![Node.js 20+](https://img.shields.io/badge/node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CI](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agy-telegram?logo=npm&logoColor=white)](https://www.npmjs.com/package/agy-telegram)
[![Tests](https://img.shields.io/badge/tests-20%20passing-2ea44f)](./test)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](./LICENSE)

</div>

Antigravity CLI Telegram Bot is a standalone tool for connecting the
Antigravity CLI to a Telegram bot. It is separate from the OpenCode Telegram
bot and is designed to run as its own systemd service under a dedicated Unix
user.

> **Security notice:** AGY can inspect and modify files and execute commands
> through its tools. Only deploy this bot for trusted Telegram users and keep
> its workspace, credentials, and sandbox configuration tightly restricted.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Install From npm](#install-from-npm)
- [Telegram Commands](#telegram-commands)
- [Configuration](#configuration)
- [Production Deployment](#production-deployment)
- [Security Model](#security-model)
- [Development](#development)
- [Project Structure](#project-structure)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

## Features

- Standalone Telegram bot and token, separate from OpenCode.
- Numeric Telegram user allowlist with optional chat allowlist.
- Private-chat-only operation by default.
- One global AGY job at a time to protect a small VPS.
- Per-chat AGY conversation mapping when AGY returns a conversation ID.
- Per-chat model, effort, execution mode, and sandbox settings.
- Persistent reply keyboard beside the Telegram input.
- Persistent keyboard limited to Model and Mode controls.
- Inline pickers for model, effort, mode, and sandbox selection.
- AGY CLI panels for models, agents, changelog, plugins, CLI help, version, update, and common options.
- Full non-interactive AGY CLI passthrough through `/agy` with shell-free argument handling.
- Streamed progress messages and live response drafts.
- Per-turn and accumulated token usage when AGY provides usage data.
- Long replies uploaded as Markdown documents.
- Process-group timeout and cancellation.
- Strict TypeScript build with a small automated test suite.
- Dangerous plugin, update, install, and permission operations require an explicit second confirmation.
- AGY is restricted to the configured workspace.

## Architecture

```text
Telegram
   |
   v
Long-polling gateway
   |
   v
Per-chat authorization and queue
   |
   v
One non-interactive AGY process
   |
   v
AGY stream-json events -> Telegram progress and response messages
```

The gateway starts AGY with `--print --output-format stream-json`, parses its
incremental NDJSON events, and edits Telegram messages as work progresses.
AGY interactive mode is intentionally not used: its full-screen PTY output
contains ANSI terminal control sequences and has no stable Telegram
request/response boundary.

## Requirements

- Node.js 20 or newer.
- The AGY CLI installed and authenticated for the service user.
- A Telegram bot created through [BotFather].
- A writable, dedicated AGY workspace.
- A Telegram user ID to add to the allowlist.

For production, install AGY at `/usr/local/bin/agy` and run this gateway as a
dedicated `agybot` user. Running the bot as root is not recommended.

## Quick Start

The recommended production installation uses the npm package. A source
checkout is only needed for development or contributing.

### 1. Create and configure the bot

Create a bot with [BotFather], then copy the token into a local environment
file. Never commit the real token.

```bash
cp .env.example .env
chmod 600 .env
```

Set at least these values in `.env`:

```dotenv
TELEGRAM_BOT_TOKEN=replace-with-botfather-token
TELEGRAM_ALLOWED_USER_IDS=123456789
AGY_BIN=/usr/local/bin/agy
AGY_WORKSPACE=/srv/agy-workspaces/default
AGY_MODE=plan
AGY_SANDBOX=1
```

Telegram numeric user IDs can be obtained using a trusted Telegram ID bot or
from an update received while diagnosing a controlled test deployment. Do not
use a username as the allowlist value.

### 2. Install dependencies and build from source

```bash
npm ci
npm run build
npm test
```

### 3. Start locally from source

```bash
set -a
. ./.env
set +a
npm start
```

Open the bot in Telegram and send `/start`. Use `/menu` to refresh the control
keyboard or send a normal text message to submit a prompt to AGY.

## Install From npm

Install the published package globally. This provides the `agy-telegram`
command and includes the compiled runtime, systemd template, environment
template, README, and license.

```bash
sudo npm install --global agy-telegram
agy-telegram --version
```

For a configured bot, run:

```bash
agy-telegram
```

For a production service, use the systemd instructions below. The package
installs the executable at `/usr/bin/agy-telegram` when npm uses the default
system prefix.

## Telegram Commands

| Command | Description |
| --- | --- |
| `/start` | Show status and safety settings. |
| `/help` | Show available commands. |
| `/menu` | Show or refresh the persistent control keyboard. |
| `/new` | Start a new AGY conversation for this chat. |
| `/models` | Open the allowed model picker. |
| `/model` | Show the current model. |
| `/model ID` | Select an allowed model. |
| `/effort` | Show the current reasoning effort. |
| `/effort LEVEL` | Set `low`, `medium`, or `high` effort. |
| `/mode` | Show the current execution mode. |
| `/mode MODE` | Set `plan` or `accept-edits` mode. |
| `/sandbox` | Show the current sandbox status. |
| `/sandbox on\|off` | Enable or disable sandbox when server policy permits it. |
| `/session` | Show conversation and runtime settings. |
| `/usage` | Show the latest and accumulated usage. |
| `/quota` | Alias for `/usage`. |
| `/status` | Show queue and active-job status. |
| `/cancel` | Cancel this chat's active or queued jobs. |
| `/agents` | List available custom AGY agents. |
| `/agent NAME` | Select a custom AGY agent for future prompts. |
| `/changelog` | Show AGY CLI release notes. |
| `/plugins` | List imported AGY plugins. |
| `/cli-help` | Show the installed `agy --help` output. |
| `/version` | Show the installed AGY CLI version. |
| `/agy ARGS...` | Run any non-interactive AGY command or subcommand using direct argv. |
| `/agy-confirm` | Confirm a pending plugin, update, install, or permission-changing command. |
| `/project ID\|clear` | Set or clear the per-chat `--project` value. |
| `/add-dir PATH\|clear` | Add a directory for future prompts, or clear the list. |
| `/output-format FORMAT` | Set `text`, `json`, or `stream-json` for future prompts. |
| `/json-schema VALUE\|clear` | Set or clear `--json-schema`. |
| `/log-file PATH\|clear` | Set or clear `--log-file`. |
| `/print-timeout VALUE\|clear` | Set or clear `--print-timeout`. |
| `/continue on\|off` | Toggle `--continue` for future prompts. |
| `/new-project on\|off` | Toggle `--new-project` for future prompts. |
| `/disable-slash-commands on\|off` | Toggle `--disable-slash-commands` for future prompts. |

Any other text is treated as an AGY prompt. `/agy` accepts the complete
non-interactive flag surface shown by `agy --help`, including repeatable
`--add-dir`, `--agent`, `--continue`, `--conversation`, `--mode`, `--model`,
`--effort`, `--json-schema`, `--log-file`, `--new-project`, `--output-format`,
`--print-timeout`, `--project`, `--sandbox`, and the `--print`/`--prompt`
aliases. Arguments are passed directly to AGY and never through a shell.
The process working directory remains fixed by `AGY_WORKSPACE`.

The full control panel is available from `/menu`. The persistent keyboard next
to the input intentionally contains only `Model` and the current `Mode` button;
model, effort, sandbox, session, usage, and AGY CLI information are available
through the inline menu and slash commands.

The inline menu exposes common flags and plugin actions; the custom command
panel covers the complete CLI surface. `--prompt-interactive` is reported but
rejected because it requires a local TTY. Plugin installation/removal, CLI
update, and `agy install` require a second `/agy-confirm` message. With
`AGY_ALLOW_DANGEROUSLY_SKIP_PERMISSIONS=1`, normal prompts and `/agy --print`
commands automatically approve tool permissions so ordinary shell commands
can run without an interactive approval prompt. The configured sandbox policy,
service user, workspace, and systemd restrictions remain in force.

## Configuration

Copy `.env.example` to an environment file outside the repository. The
following variables are supported:

| Variable | Default | Description |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Required | Token generated by BotFather. |
| `TELEGRAM_ALLOWED_USER_IDS` | Required | Comma-separated numeric Telegram user IDs. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Empty | Optional comma-separated chat ID allowlist. |
| `TELEGRAM_PRIVATE_ONLY` | `1` | Reject non-private chats unless set to `0`. |
| `TELEGRAM_MAX_MESSAGE_CHARS` | `3900` | Telegram message chunk size. |
| `AGY_BIN` | `/root/.local/bin/agy` | Absolute path to the AGY executable. |
| `AGY_WORKSPACE` | `/srv/agy-workspaces/default` | Only working directory AGY may use. Must be absolute. |
| `AGY_PROJECT` | Empty | Optional AGY project identifier. |
| `AGY_MODE` | `plan` | AGY mode: `plan` or `accept-edits`. |
| `AGY_SANDBOX` | `1` | Enable AGY terminal restrictions by default. |
| `AGY_ALLOW_SANDBOX_DISABLE` | `0` | Permit users to turn off the sandbox. Keep disabled unless deliberate. |
| `AGY_MODEL` | Empty | Default model. Empty uses AGY's default model. |
| `AGY_EFFORT` | `high` | Default reasoning effort: `low`, `medium`, or `high`. |
| `AGY_AGENT` | Empty | Optional default custom agent passed as `--agent`. |
| `AGY_ALLOW_DANGEROUSLY_SKIP_PERMISSIONS` | `1` | Full-control mode: automatically approve AGY tool permissions for normal prompts. Keep the sandbox and service restrictions enabled. |
| `AGY_ALLOWED_MODELS` | All known models | Comma-separated allowlist used by `/models` and `/model`. |
| `AGY_TIMEOUT_MS` | `1800000` | Maximum AGY runtime in milliseconds. |
| `AGY_MAX_OUTPUT_BYTES` | `20000000` | Maximum captured AGY output. |
| `MAX_QUEUE_SIZE` | `8` | Maximum queued prompts across chats. |
| `STATE_FILE` | `/var/lib/agy-telegram/state.json` | Persistent offset, sessions, settings, and usage. |
| `TEMP_DIR` | `/var/lib/agy-telegram/tmp` | Runtime temporary directory. |
| `LOG_LEVEL` | `info` | Reserved logging-level setting. |

The configuration loader rejects missing tokens, empty user allowlists,
invalid Telegram IDs, relative workspaces, unsupported modes or effort levels,
and models outside the configured model allowlist.

### Supported models

The built-in model allowlist currently includes:

- `gemini-3.6-flash-high`
- `gemini-3.6-flash-medium`
- `gemini-3.6-flash-low`
- `gemini-3.5-flash-high`
- `gemini-3.5-flash-medium`
- `gemini-3.5-flash-low`
- `gemini-3.1-pro-high`
- `gemini-3.1-pro-low`
- `claude-sonnet-4-6`
- `claude-opus-4-6-thinking`
- `gpt-oss-120b-medium`

AGY may expose usage fields such as input, output, thinking, cache-read, and
total tokens. The gateway displays values supplied by AGY and does not estimate
billing usage or subscription quota.

## Production Deployment

The repository includes a hardened systemd unit at
[`deploy/agy-telegram.service`](./deploy/agy-telegram.service) and an
environment template at [`deploy/agy-telegram.env.example`](./deploy/agy-telegram.env.example).

### 1. Prepare the service user and directories

```bash
sudo useradd --system --home-dir /var/lib/agybot --create-home --shell /usr/sbin/nologin agybot
sudo install -d -o agybot -g agybot -m 0750 /var/lib/agy-telegram/tmp
sudo install -d -o agybot -g agybot -m 0750 /srv/agy-workspaces/default
```

Install and authenticate AGY for `agybot`, then verify that the service user
can access the configured workspace and AGY credential cache:

```bash
sudo -u agybot -H /usr/local/bin/agy --version
```

### 2. Install the npm package

```bash
sudo npm install --global agy-telegram
agy-telegram --help
```

Use the package metadata to locate the installed deployment templates:

```bash
NPM_PACKAGE_DIR="$(npm root --global)/agy-telegram"
ls "$NPM_PACKAGE_DIR/deploy"
```

### 3. Install and edit the service environment

```bash
NPM_PACKAGE_DIR="$(npm root --global)/agy-telegram"
sudo install -m 0600 -o root -g root "$NPM_PACKAGE_DIR/deploy/agy-telegram.env.example" /etc/agy-telegram.env
sudoedit /etc/agy-telegram.env
```

Replace all placeholders. At minimum, configure the real BotFather token and
one or more numeric Telegram user IDs.

### 4. Enable the service

```bash
NPM_PACKAGE_DIR="$(npm root --global)/agy-telegram"
sudo install -m 0644 "$NPM_PACKAGE_DIR/deploy/agy-telegram.service" /etc/systemd/system/agy-telegram.service
sudo systemctl daemon-reload
sudo systemctl enable --now agy-telegram
sudo systemctl status agy-telegram
sudo journalctl -u agy-telegram -f
```

The unit runs as `agybot`, uses `/var/lib/agybot` as `HOME`, keeps the process
inside the configured workspace, and applies CPU, memory, task, and systemd
filesystem restrictions. Review `ReadWritePaths` and AGY's authentication path
for your host before starting the service.

## Security Model

This project is a control gateway, not a complete authorization boundary for
an untrusted user. Keep all of the following controls enabled:

- Use a dedicated Telegram bot token and never commit it.
- Allow only trusted numeric Telegram user IDs.
- Keep `TELEGRAM_PRIVATE_ONLY=1` unless group operation is intentional.
- Run the service as a dedicated non-root Unix user.
- Give AGY a dedicated, least-privilege workspace rather than `/root` or `/`.
- Keep `AGY_MODE=plan` for unattended operation unless edits are explicitly intended.
- Keep `AGY_SANDBOX=1` and `AGY_ALLOW_SANDBOX_DISABLE=0` by default.
- Full-control mode may add `--dangerously-skip-permissions` automatically for
  normal prompts; keep `AGY_SANDBOX=1`, the dedicated service user, and the
  systemd workspace restrictions enabled.
- Store `/etc/agy-telegram.env` and the state file with mode `0600`.
- Keep SSH keys, cloud credentials, AGY credentials, and unrelated repositories
  outside the AGY workspace.
- Review systemd resource and write-path restrictions before deployment.

If a token is ever pasted into a chat, terminal transcript, issue, or log,
revoke it in BotFather or the relevant provider and issue a replacement.

## Development

The project uses strict TypeScript and emits compiled JavaScript into `dist/`.
Generated output and dependencies are intentionally ignored by Git.

```bash
npm ci
npm run build
npm test
npm run pack:check
git diff --check
```

The package can be tested locally before publishing:

```bash
npm pack
npm install --global ./agy-telegram-0.1.0.tgz
```

Do not commit the generated `.tgz` file. It is ignored by Git and should be
removed after a local installation test.

## npm Publishing

GitHub Actions runs on every pull request and push to `main`. The CI workflow
tests Node.js 20 and 22, builds the TypeScript output, runs the test suite, and
uploads an npm tarball as a workflow artifact.

Publishing is triggered by pushing a semantic version tag such as `v0.2.0`:

```bash
npm version minor
git push origin main --follow-tags
```

Before the first publish, add an npm access token with package publish access
as the repository secret `NPM_TOKEN`. The publish workflow verifies the package
contents and publishes with npm provenance enabled. Keep the npm token out of
commits, logs, and command arguments.

Before opening a pull request:

1. Keep secrets and local state outside the repository.
2. Add or update tests for behavior changes.
3. Run the build and full test suite.
4. Document configuration or deployment changes in this README.

## Project Structure

```text
src/
  agy-runner.ts   AGY process execution and stream-json parsing
  config.ts       Environment parsing and safety validation
  index.ts        Telegram polling, commands, callbacks, and job lifecycle
  keyboards.ts    Persistent Telegram reply keyboard
  models.ts       Built-in model catalog
  queue.ts        Global job queue and cancellation
  state.ts        Persistent sessions, offsets, settings, and usage
  telegram.ts     Typed Telegram Bot API client
  types.ts        Shared TypeScript types
test/             Node test runner tests
deploy/           systemd unit and deployment environment template
.github/workflows/ CI, package build, and npm publish workflows
```

## Limitations

- Long polling is used instead of a webhook.
- Only one AGY job runs globally at a time.
- Telegram output is chunked or uploaded as Markdown for long responses.
- Subscription quota is not available from AGY `stream-json` and cannot be
  calculated by this gateway.
- AGY interactive PTY mode is not supported because terminal escape sequences
  do not provide a reliable Telegram message boundary.

## Contributing

Issues and pull requests are welcome. Please include the motivation, expected
behavior, test coverage, and any security or deployment impact in your change.
Do not include bot tokens, AGY credentials, private workspace files, or server
logs containing secrets.

## License

This project is licensed under the [MIT License](./LICENSE).

[BotFather]: https://t.me/BotFather
