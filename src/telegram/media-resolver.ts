import dns from "node:dns/promises";
import fs from "node:fs/promises";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { splitMessage } from "./markdown-renderer.js";

function isPrivateOrReservedIp(ip: string): boolean {
  let cleanIp = ip.toLowerCase().trim().replace(/\.$/, "");
  if (cleanIp === "::1" || cleanIp === "::" || cleanIp.startsWith("fe80:") || cleanIp.startsWith("fc00:") || cleanIp.startsWith("fd")) {
    return true;
  }
  if (cleanIp.startsWith("::ffff:")) {
    cleanIp = cleanIp.substring(7);
  }
  const ipVersion = isIP(cleanIp);
  if (ipVersion === 4) {
    const parts = cleanIp.split(".").map(Number);
    const [b0, b1] = parts;
    if (b0 === 127 || b0 === 10 || b0 === 0) return true;
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    if (b0 === 192 && b1 === 168) return true;
    if (b0 === 169 && b1 === 254) return true;
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    if (b0 >= 224) return true;
  }
  return false;
}

export async function isPrivateOrReservedHost(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase().trim().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
    return true;
  }
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return true;
  }
  if (isPrivateOrReservedIp(host)) {
    return true;
  }
  try {
    const addresses = await dns.lookup(host, { all: true });
    if (!addresses || addresses.length === 0) return true;
    return addresses.some(({ address }) => isPrivateOrReservedIp(address));
  } catch {
    return true;
  }
}

export function isAllowedLocalMediaPath(filePath: string, workspaceDir?: string): boolean {
  const resolved = path.resolve(filePath);
  const tempDir = path.resolve(os.tmpdir());
  const varTmp = path.resolve("/var/tmp");
  const brainDir = path.resolve(os.homedir(), ".gemini/antigravity-cli/brain");
  if (resolved.startsWith(tempDir) || resolved.startsWith(varTmp) || resolved.startsWith(brainDir)) return true;
  if (workspaceDir) {
    const ws = path.resolve(workspaceDir);
    const rel = path.relative(ws, resolved);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  }
  return false;
}

export async function findReferencedMediaFiles(text: string, workspaceDir?: string): Promise<string[]> {
  const candidates = new Set<string>();

  // 1. Markdown image embeds: ![caption](/path/to/img.png) or ![caption](file:///path/to/img.png)
  const mdImgRegex = /!\[.*?\]\((?:file:\/\/)?([^\s)]+?\.(?:png|jpe?g|webp|gif|svg))\)/gi;
  for (const match of text.matchAll(mdImgRegex)) {
    const rawPath = match[1].trim();
    candidates.add(rawPath);
  }

  // 2. HTML img tags: <img src="/path/to/img.png">
  const htmlImgRegex = /<img[^>]+src=["'](?:file:\/\/)?([^"']+\.(?:png|jpe?g|webp|gif|svg))["']/gi;
  for (const match of text.matchAll(htmlImgRegex)) {
    const rawPath = match[1].trim();
    candidates.add(rawPath);
  }

  // 3. Temporary / preview images (e.g. /tmp/preview_*.jpg or /tmp/*.png)
  const mediaPathRegex = /(?:^|[\s"'`(\[])(\/(?:tmp|var\/tmp)[^\s"'`)\]]+\.(?:png|jpe?g|webp|gif|svg))/gi;
  for (const match of text.matchAll(mediaPathRegex)) {
    candidates.add(match[1].trim());
  }

  const validFiles: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || candidate.startsWith("http://") || candidate.startsWith("https://")) continue;
    const resolved = path.isAbsolute(candidate)
      ? candidate
      : (workspaceDir ? path.resolve(workspaceDir, candidate) : path.resolve(candidate));
    if (!isAllowedLocalMediaPath(resolved, workspaceDir)) continue;
    try {
      const stat = await fs.stat(resolved);
      if (stat.isFile() && stat.size > 0 && stat.size < 50 * 1024 * 1024) {
        if (!validFiles.includes(resolved)) {
          validFiles.push(resolved);
        }
      }
    } catch {
      // file does not exist locally, skip
    }
  }

  // 4. Public Web Images: ![caption](https://example.com/image.png) or https://.../img.jpg
  const webImgRegex = /!?\[.*?\]\((https?:\/\/[^\s)]+?\.(?:png|jpe?g|webp|gif|svg))\)|(?:^|[\s"'`(\[])(https?:\/\/[^\s"'`)\]]+?\.(?:png|jpe?g|webp|gif|svg))/gi;
  for (const match of text.matchAll(webImgRegex)) {
    const webUrl = (match[1] || match[2] || "").trim();
    if (!webUrl) continue;
    try {
      const parsedUrl = new URL(webUrl);
      if (await isPrivateOrReservedHost(parsedUrl.hostname)) continue;

      const ext = path.extname(parsedUrl.pathname).toLowerCase() || ".jpg";
      const hash = Buffer.from(webUrl).toString("base64url").slice(0, 24);
      const targetPath = path.join(os.tmpdir(), `web_media_${hash}${ext}`);
      const stat = await fs.stat(targetPath).catch(() => null);
      if (!stat || stat.size === 0) {
        const res = await fetch(webUrl, { redirect: "manual", signal: AbortSignal.timeout(8000) });
        if ([301, 302, 303, 307, 308].includes(res.status)) continue;
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          if (buffer.length < 20 * 1024 * 1024) { // max 20MB
            await fs.writeFile(targetPath, buffer);
          }
        }
      }
      const finalStat = await fs.stat(targetPath).catch(() => null);
      if (finalStat && finalStat.size > 0 && !validFiles.includes(targetPath)) {
        validFiles.push(targetPath);
      }
    } catch {
      // ignore download failure
    }
  }

  return validFiles;
}
