import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { splitMessage } from "./markdown-renderer.js";
function isPrivateOrReservedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [b0, b1] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (b0 === 127) return true;
    if (b0 === 10) return true;
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    if (b0 === 192 && b1 === 168) return true;
    if (b0 === 169 && b1 === 254) return true;
    if (b0 === 0) return true;
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
  }
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc00:") || host.startsWith("fd")) {
    return true;
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
      if (isPrivateOrReservedHost(parsedUrl.hostname)) continue;

      const ext = path.extname(parsedUrl.pathname).toLowerCase() || ".jpg";
      const hash = Buffer.from(webUrl).toString("base64url").slice(0, 24);
      const targetPath = path.join(os.tmpdir(), `web_media_${hash}${ext}`);
      const stat = await fs.stat(targetPath).catch(() => null);
      if (!stat || stat.size === 0) {
        const res = await fetch(webUrl, { signal: AbortSignal.timeout(8000) });
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
