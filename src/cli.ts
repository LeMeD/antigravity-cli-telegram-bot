#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { name: string; version: string };

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(packageJson.version);
  process.exit(0);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`${packageJson.name} ${packageJson.version}

Start the AGY Telegram gateway.

Usage:
  agy-telegram
  agy-telegram --version
  agy-telegram --help

Configure the gateway through environment variables. See the README for the
complete configuration and deployment guide.`);
  process.exit(0);
}

await import("./index.js");
