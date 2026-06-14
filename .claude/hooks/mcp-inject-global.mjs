#!/usr/bin/env node
/**
 * MCP Global Injection Hook
 *
 * Mirrors every MCP server declared in the project's `.mcp.json` into the
 * user-scope config (`~/.claude.json`) with absolute paths resolved against
 * the project root.  This makes project MCP servers available to spawned
 * subagents (which only inherit user-scope MCP) and lets any `git clone` of
 * the project "just work" — Claude Code reads `.claude/settings.json`, fires
 * this hook, and the servers become available regardless of clone location.
 *
 * Idempotent — uses a sentinel file (`~/.claude/.mcp-inject-sentinel.json`)
 * keyed by project root × SHA-256 hash of `.mcp.json` content.  When nothing
 * changed the hook returns in <5 ms (hash compare only).  When something
 * changed it updates both `~/.claude.json` and the sentinel.
 *
 * Registered in `.claude/settings.json` under `hooks.UserPromptSubmit` and
 * runs BEFORE the mcp-preflight hook so preflight can see the servers.
 */

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root — the environment var is set by Claude Code at hook runtime. */
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR
  ? path.resolve(process.env.CLAUDE_PROJECT_DIR)
  : path.resolve(__dirname, '../..');

const USER_CONFIG = path.resolve(process.env.HOME || '~', '.claude.json');
const SENTINEL_PATH = path.resolve(
  process.env.HOME || '~',
  '.claude/.mcp-inject-sentinel.json',
);
const MCP_JSON_PATH = path.join(PROJECT_ROOT, '.mcp.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute a SHA-256 hex digest. */
function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Thin wrapper around readFileSync that returns null on ENOENT. */
function tryRead(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Read and parse JSON; return null on any error. */
function tryParse(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Resolve a relative `arg` string to an absolute path if it looks like a
 * file path (contains `/` or `\`).  Bare command names (`node`, `npx`),
 * flags (`-y`, `--port`), npm scoped packages (`@foo/bar`), env vars
 * (`$PATH`), and URLs are left as-is.
 */
function resolveArg(arg, root) {
  if (
    arg.startsWith('/') || arg.startsWith('-') || arg.startsWith('@') ||
    arg.startsWith('$') || arg.includes('://') ||
    (/^[a-zA-Z0-9._-]+$/).test(arg)
  ) {
    return arg; // not a path — keep verbatim
  }
  return path.resolve(root, arg);
}

/**
 * Resolve all path-like arguments in a server config against the project root.
 * Handles `command`, all entries in `args`, and `env` values (unchanged).
 */
function resolveConfig(entry, root) {
  const resolved = { ...entry };
  if (typeof resolved.command === 'string') {
    resolved.command = resolveArg(resolved.command, root);
  }
  if (Array.isArray(resolved.args)) {
    resolved.args = resolved.args.map((a) => resolveArg(a, root));
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // 1. Read .mcp.json  —  if absent / empty, nothing to do
  const mcpJsonRaw = tryRead(MCP_JSON_PATH);
  if (!mcpJsonRaw) {
    process.stdout.write('{}');
    return;
  }

  const mcpJson = tryParse(mcpJsonRaw);
  if (!mcpJson || !mcpJson.mcpServers || typeof mcpJson.mcpServers !== 'object') {
    process.stdout.write('{}');
    return;
  }

  const projectServers = mcpJson.mcpServers; // { name: { command, args, ... }, ... }
  const serverNames = Object.keys(projectServers);
  if (serverNames.length === 0) {
    process.stdout.write('{}');
    return;
  }

  // 2. Hash — used as the skip-sentinel
  const hash = sha256(mcpJsonRaw);

  // 3. Sentinel fast path — same root + same hash => nothing changed
  const sentinelRaw = tryRead(SENTINEL_PATH);
  const sentinel = tryParse(sentinelRaw) || {};
  const prev = sentinel[PROJECT_ROOT];
  if (prev && prev.hash === hash) {
    process.stdout.write('{}');
    return;
  }

  // 4. Something changed — read user config, apply, write back
  const userRaw = tryRead(USER_CONFIG) || '{}';
  const userCfg = tryParse(userRaw) || {};
  if (!userCfg.mcpServers || typeof userCfg.mcpServers !== 'object') {
    userCfg.mcpServers = {};
  }

  // 4a. Upsert each server from .mcp.json with resolved absolute paths
  for (const name of serverNames) {
    userCfg.mcpServers[name] = resolveConfig(projectServers[name], PROJECT_ROOT);
  }

  // 4b. Remove servers that were previously injected by THIS project
  //     but have been removed from .mcp.json
  const previously = prev?.servers || [];
  for (const oldName of previously) {
    if (!projectServers[oldName]) {
      delete userCfg.mcpServers[oldName];
    }
  }

  // 4c. Write back user config — pretty-printed, trailing newline
  writeFileSync(USER_CONFIG, JSON.stringify(userCfg, null, 2) + '\n', 'utf8');

  // 5. Update sentinel
  sentinel[PROJECT_ROOT] = {
    hash,
    servers: serverNames,
    injectedAt: new Date().toISOString(),
  };
  writeFileSync(SENTINEL_PATH, JSON.stringify(sentinel, null, 2) + '\n', 'utf8');
}

try {
  main();
} catch (err) {
  // Never block the user prompt — log to stderr and let it pass
  process.stderr.write(`[mcp-inject-global] error: ${err.message}\n`);
} finally {
  process.stdout.write('{}');
}
