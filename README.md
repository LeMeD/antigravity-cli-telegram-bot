# AGY Telegram Bot

Standalone Telegram gateway for the AGY CLI. This project is separate from the
OpenCode Telegram bot and is designed to run as its own systemd service.

The bot starts one non-interactive AGY process per queued Telegram prompt:

```text
Telegram -> long polling bot -> per-chat queue -> agy --print -> Telegram
```

## Current Scope

- Separate Telegram bot and token from OpenCode.
- Numeric Telegram user allowlist, with optional chat allowlist.
- Private-chat-only default.
- One global AGY job at a time to protect the VPS.
- Per-chat conversation mapping when AGY exposes a conversation ID.
- `/new`, `/status`, `/cancel`, and `/help` commands.
- Long replies are uploaded as Markdown documents.
- Process-group timeout and cancellation.
- No `--dangerously-skip-permissions` support.
- AGY runs only from the configured workspace.

The bot does not run until a real Telegram token and allowlisted user ID are
provided in an environment file.

## Requirements

- Node.js 20+
- AGY CLI installed and authenticated for the service user.
- A Telegram bot created with BotFather.
- A writable workspace directory.

The current VPS has AGY at `/root/.local/bin/agy`, but the deployment template
expects the binary at `/usr/local/bin/agy` so it can run as the dedicated
`agybot` user. Install/copy AGY there and authenticate AGY for that user before
deployment. Running the bot as root is not recommended for production.

## Local Development

```bash
cp .env.example .env
chmod 600 .env
# Edit .env with a real token and allowlisted numeric user ID.
npm test
set -a; . ./.env; set +a; node src/index.js
```

Do not put secrets in the repository or command history.

## Supported Commands

```text
/start       Show the bot status and safety settings
/help        Show available commands
/new         Start a new AGY conversation for this chat
/status      Show queue and active-job status
/cancel      Cancel this chat's active or queued job
```

Any other text is sent to AGY as a prompt. The bot does not accept arbitrary
filesystem paths as commands; the process working directory is fixed by
`AGY_WORKSPACE`.

## Configuration

Copy `.env.example` to an environment file outside the repo. Important values:

- `TELEGRAM_BOT_TOKEN`: required BotFather token.
- `TELEGRAM_ALLOWED_USER_IDS`: required comma-separated numeric IDs.
- `AGY_WORKSPACE`: absolute directory AGY can access.
- `AGY_MODE=plan`: recommended default; prevents unattended edits.
- `AGY_SANDBOX=1`: asks AGY to enable its terminal restrictions.
- `STATE_FILE`: persistent Telegram offset and conversation mapping.

The parser rejects an empty allowlist and invalid numeric IDs. It also rejects a
workspace that is not absolute.

## Systemd

The repository includes a hardened service template:

```bash
sudo install -d -m 0750 /opt/agy-telegram /var/lib/agy-telegram
sudo cp -a . /opt/agy-telegram
sudo install -m 0640 deploy/agy-telegram.service /etc/systemd/system/agy-telegram.service
sudo install -m 0600 deploy/agy-telegram.env.example /etc/agy-telegram.env
# Edit /etc/agy-telegram.env and replace placeholders before starting.
sudo systemctl daemon-reload
sudo systemctl enable --now agy-telegram
sudo journalctl -u agy-telegram -f
```

Review the service's `User`, `ReadWritePaths`, and AGY authentication path before
starting it. The template intentionally uses `agybot` rather than root.

## Safety Notes

AGY can inspect and modify files and can run commands through its tools. Only
allow trusted Telegram user IDs. Keep the bot in private chats until the
workflow is proven. Do not pass `--dangerously-skip-permissions`, and do not
expose `/root`, SSH keys, credential directories, or the whole filesystem as a
workspace.

This bot is a control gateway, not an authorization boundary for an untrusted
user. Telegram allowlisting, a dedicated Unix user, a restricted workspace,
AGY sandbox mode, timeouts, and systemd limits must all remain enabled.
