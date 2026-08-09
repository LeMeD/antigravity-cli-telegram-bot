import { spawn } from "node:child_process";
import type { AgyConfig } from "./types.js";

export function cleanAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?:>=<!]*[ -/]*[@-~a-zA-Z]/g, "")
    .replace(/\x1b[()#%*+-.][0-9a-zA-Z]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r/g, "");
}

function stripProgressBar(str: string): string {
  return str.replace(/[█░▒▓━═─\-_[\]=><#]+/g, " ").replace(/\s+/g, " ").trim();
}

export function parseUsageQuota(rawOutput: string): string {
  const text = cleanAnsi(rawOutput).trim();

  // Validate that the output contains actual quota information, not just a startup screen
  const hasQuotaIndicator =
    /models?\s*&\s*quota|weekly\s*limit|gemini\s*models?|claude\s*(?:and|\/)\s*gpt|quota\s*available/i.test(text);
  if (!hasQuotaIndicator) {
    throw new Error(
      `AGY did not produce a Models & Quota report.\n\nCaptured output:\n${text.slice(0, 500) || "(empty)"}`
    );
  }

  // Extract account email
  const accountMatch = text.match(/(?:Account|User|Email):\s*([^\n\r]+)/i);
  const account = accountMatch ? accountMatch[1].trim() : null;

  // Split into Gemini and Claude sections
  const geminiPartMatch = text.match(
    /(?:GEMINI\s*MODELS?|Gemini)[\s\S]*?(?=(?:CLAUDE\s*(?:AND|\/)\s*GPT(?:\s*MODELS?)?|Claude)|$)/i
  );
  const geminiPart = geminiPartMatch ? geminiPartMatch[0] : "";

  const claudePartMatch = text.match(
    /(?:CLAUDE\s*(?:AND|\/)\s*GPT(?:\s*MODELS?)?|Claude)[\s\S]*$/i
  );
  const claudePart = claudePartMatch ? claudePartMatch[0] : "";

  const extractLimits = (
    sectionText: string
  ): { weekly: string | null; weeklyRefresh: string | null; fiveHour: string | null; fiveHourRefresh: string | null } => {
    let weekly: string | null = null;
    let weeklyRefresh: string | null = null;
    let fiveHour: string | null = null;
    let fiveHourRefresh: string | null = null;

    // Weekly limit
    const weeklyMatch = sectionText.match(
      /Weekly\s*Limit(?:\s*Remaining)?[\s\S]*?(?=(?:Five\s*Hour|5\s*Hour|CLAUDE|GEMINI|$))/i
    );
    if (weeklyMatch) {
      const cleanWeekly = stripProgressBar(weeklyMatch[0]);
      const valMatch = cleanWeekly.match(
        /(\d+(?:\.\d+)?%\s*(?:remaining|available|Quota available)|Quota available|\d+(?:\.\d+)?%\s*left)/i
      );
      if (valMatch) weekly = valMatch[1].trim();
      const refreshMatch = cleanWeekly.match(/Refreshes\s*in\s*([0-9a-zA-Z\s]+)/i);
      if (refreshMatch) weeklyRefresh = refreshMatch[1].trim();
    }

    // Five hour limit
    const fiveHourMatch = sectionText.match(
      /(?:Five|5)\s*Hour\s*Limit(?:\s*Remaining)?[\s\S]*?(?=(?:Weekly|CLAUDE|GEMINI|$))/i
    );
    if (fiveHourMatch) {
      const cleanFive = stripProgressBar(fiveHourMatch[0]);
      const valMatch = cleanFive.match(
        /(\d+(?:\.\d+)?%\s*(?:remaining|available|Quota available)|Quota available|\d+(?:\.\d+)?%\s*left)/i
      );
      if (valMatch) fiveHour = valMatch[1].trim();
      const refreshMatch = cleanFive.match(/Refreshes\s*in\s*([0-9a-zA-Z\s]+)/i);
      if (refreshMatch) fiveHourRefresh = refreshMatch[1].trim();
    }

    return { weekly, weeklyRefresh, fiveHour, fiveHourRefresh };
  };

  const gemini = extractLimits(geminiPart);
  const claude = extractLimits(claudePart);

  const lines = ["📊 <b>Models & Quota</b>\n"];
  if (account) lines.push(`<b>Account:</b> <code>${account}</code>\n`);

  if (gemini.weekly || gemini.fiveHour) {
    lines.push("<b>Gemini Models</b>");
    if (gemini.weekly) {
      lines.push(
        `• Weekly Limit: <b>${gemini.weekly}</b>${gemini.weeklyRefresh ? ` (Refreshes in ${gemini.weeklyRefresh})` : ""}`
      );
    }
    if (gemini.fiveHour) {
      lines.push(
        `• 5-Hour Limit: <b>${gemini.fiveHour}</b>${gemini.fiveHourRefresh ? ` (Refreshes in ${gemini.fiveHourRefresh})` : ""}`
      );
    }
    lines.push("");
  }

  if (claude.weekly || claude.fiveHour) {
    lines.push("<b>Claude & GPT Models</b>");
    if (claude.weekly) {
      lines.push(
        `• Weekly Limit: <b>${claude.weekly}</b>${claude.weeklyRefresh ? ` (Refreshes in ${claude.weeklyRefresh})` : ""}`
      );
    }
    if (claude.fiveHour) {
      lines.push(
        `• 5-Hour Limit: <b>${claude.fiveHour}</b>${claude.fiveHourRefresh ? ` (Refreshes in ${claude.fiveHourRefresh})` : ""}`
      );
    }
    lines.push("");
  }

  if (!account && !gemini.weekly && !gemini.fiveHour && !claude.weekly && !claude.fiveHour) {
    const cleanLines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.includes("/usage") && !l.startsWith("❯") && !l.startsWith(">"));
    lines.push(cleanLines.join("\n"));
  }

  return lines.join("\n").trim();
}

export function parseCredits(rawOutput: string): string {
  const text = cleanAnsi(rawOutput).trim();

  // Validate that credits or balance information was returned
  const hasCreditsIndicator = /credits?|balance|purchase|buy/i.test(text);
  if (!hasCreditsIndicator) {
    throw new Error(
      `AGY did not produce a Credits report.\n\nCaptured output:\n${text.slice(0, 500) || "(empty)"}`
    );
  }

  const creditsMatch =
    text.match(/(?:(?:G1\s+)?credits\s*remaining|(?:available\s+)?credits|balance)[:\s]*([0-9$][^\n\r]*)/i) ||
    text.match(/([0-9]+(?:\.[0-9]+)?\s*(?:credits|G1 credits))/i);

  const purchaseMatch =
    text.match(/(?:Purchase(?:\s+link)?|Buy)[:\s]*(https?:\/\/[^\s)]+)/i) ||
    text.match(/(https?:\/\/[^\s)]+)/i);

  const lines = ["💳 <b>AGY Credits</b>\n"];
  if (creditsMatch) {
    lines.push(`• Credits Remaining: <b>${creditsMatch[1].trim()}</b>`);
  }
  if (purchaseMatch) {
    const url = purchaseMatch[1].trim();
    lines.push(`• Purchase / Top-up: <a href="${url}">${url}</a>`);
  }

  if (!creditsMatch && !purchaseMatch) {
    const cleanLines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.includes("/credits") && !l.startsWith("❯") && !l.startsWith(">"));
    lines.push(cleanLines.join("\n"));
  }

  return lines.join("\n").trim();
}

const PTY_SCRIPT = `
import pty, os, sys, time, select, signal, re, struct, fcntl, termios

def clean_ansi(text):
    text = re.sub(r'\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)', '', text)
    text = re.sub(r'\\x1b\\[[0-9;?:>=<!]*[ -/]*[@-~a-zA-Z]', '', text)
    text = re.sub(r'\\x1b[()#%*+-.][0-9a-zA-Z]', '', text)
    text = re.sub(r'\\x1b[@-Z\\\\-_]', '', text)
    return re.sub(r'[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]', '', text).replace('\\r', '')

bin_path = sys.argv[1]
cwd = sys.argv[2]
cmd_to_send = sys.argv[3]
timeout_sec = float(sys.argv[4]) if len(sys.argv) > 4 else 25.0

master, slave = pty.openpty()
pid = os.fork()
if pid == 0:
    os.close(master)
    os.setsid()
    try:
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    except Exception:
        pass
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    os.close(slave)
    if os.path.isdir(cwd):
        try:
            os.chdir(cwd)
        except Exception:
            pass
    env = dict(os.environ)
    env['TERM'] = 'xterm-256color'
    env['NO_COLOR'] = '0'
    if 'HOME' not in env or not env['HOME']:
        env['HOME'] = os.path.expanduser('~')
    for k in ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USER_IDS', 'TELEGRAM_ALLOWED_CHAT_IDS']:
        env.pop(k, None)
    try:
        os.execvpe(bin_path, [bin_path], env)
    except Exception as e:
        sys.stderr.write(f"exec failed: {e}\\n")
    sys.exit(1)

os.close(slave)
output = b''
start = time.time()
sent_command = False
handled_trust = False
last_data_time = time.time()
prompt_first_seen = None
retried_enter = False

try:
    while time.time() - start < timeout_sec:
        r, _, _ = select.select([master], [], [], 0.05)
        if master in r:
            try:
                data = os.read(master, 4096)
                if not data:
                    break
                output += data
                last_data_time = time.time()
            except OSError:
                break

        decoded = output.decode('utf-8', errors='ignore')
        cleaned = clean_ansi(decoded)
        lower_cleaned = cleaned.lower()

        # Check if login menu is explicitly asking for OAuth selection
        if not sent_command and ('select login method' in lower_cleaned and 'use arrow keys' in lower_cleaned):
            sys.stdout.write("Error: AGY CLI is not signed in. Please authenticate AGY on the server.\\n")
            sys.exit(0)

        # Handle trust / confirmation dialog
        if not handled_trust and ('trust' in lower_cleaned or 'do you trust' in lower_cleaned) and ('[y/n]' in lower_cleaned or 'yes/no' in lower_cleaned or '?' in lower_cleaned):
            time.sleep(0.3)
            try:
                os.write(master, b'y\\r')
            except OSError:
                pass
            handled_trust = True
            time.sleep(0.4)
            continue

        # Check active prompt readiness. AGY places the prompt between TUI
        # rows, so it may be in the middle of the accumulated buffer.
        has_prompt_symbol = bool(re.search(r'(?m)^[ \\t]*[❯>][ \\t]*(?:\\n|$)', cleaned)) or ('type a command' in lower_cleaned) or ('ask anything' in lower_cleaned)

        if not sent_command:
            if has_prompt_symbol:
                if prompt_first_seen is None:
                    prompt_first_seen = time.time()

                # Wait until at least 0.5s elapsed since prompt appeared AND output has settled for 0.3s
                if (time.time() - prompt_first_seen >= 0.5) and (time.time() - last_data_time >= 0.3):
                    # Type characters with tiny delay to allow TUI state update
                    for ch in cmd_to_send:
                        os.write(master, ch.encode('utf-8'))
                        time.sleep(0.03)
                    time.sleep(0.1)
                    # Submit with \\r (Carriage Return)
                    os.write(master, b'\\r')
                    sent_command = True
                    output = b'' # Clear startup buffer
                    last_data_time = time.time()
                    continue

        # After sending command
        if sent_command:
            has_quota_result = ('models & quota' in lower_cleaned) or ('weekly limit' in lower_cleaned) or ('credits remaining' in lower_cleaned) or ('g1 credits' in lower_cleaned) or ('balance:' in lower_cleaned)
            if has_quota_result:
                if time.time() - last_data_time >= 0.8:
                    break

            # If 1.8s passed without response after typing, retry sending Enter once
            if not retried_enter and time.time() - last_data_time >= 1.8 and not has_quota_result:
                try:
                    os.write(master, b'\\r')
                except OSError:
                    pass
                retried_enter = True
                last_data_time = time.time()

            if time.time() - last_data_time >= 3.0 and len(output) > 0:
                break
finally:
    try:
        os.kill(pid, signal.SIGTERM)
        time.sleep(0.1)
        os.kill(pid, signal.SIGKILL)
    except Exception:
        pass
    os.close(master)
    try:
        os.waitpid(pid, 0)
    except Exception:
        pass

decoded = output.decode('utf-8', errors='ignore')
sys.stdout.write(clean_ansi(decoded))
`;

export interface PtyRunnerOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function runPtyCommand(
  config: AgyConfig,
  command: "/usage" | "/credits",
  options: PtyRunnerOptions = {}
): Promise<string> {
  const { timeoutMs = 25_000, signal } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error("PTY command cancelled"));
    }

    const timeoutSec = Math.max(2, Math.ceil(timeoutMs / 1000));
    const child = spawn("python3", ["-c", PTY_SCRIPT, config.bin, config.workspace, command, String(timeoutSec)], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const killProcessGroup = (): void => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }
    };

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback();
    };

    const abort = (): void => {
      killProcessGroup();
      finish(() => reject(new Error("PTY command cancelled")));
    };

    const timer = setTimeout(() => {
      killProcessGroup();
      finish(() => reject(new Error(`PTY command ${command} timed out after ${timeoutMs}ms`)));
    }, timeoutMs + 2000);

    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      killProcessGroup();
      finish(() => reject(error));
    });

    child.on("close", (code, sig) =>
      finish(() => {
        if (code !== 0 && !stdout.trim()) {
          const detail = stderr.trim().slice(0, 500);
          reject(new Error(`PTY ${command} exited with ${code ?? sig}${detail ? `: ${detail}` : ""}`));
          return;
        }
        resolve(stdout.trim() || stderr.trim() || "AGY returned no output.");
      })
    );
  });
}
