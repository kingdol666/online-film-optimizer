import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { join, resolve, relative } from 'path';
import { PROJECT_ROOT } from '../../../../config/loader.mjs';
import { db, stmts } from '../db/database.mjs';

const TOKEN_PREFIX = 'idd_';
const TOKEN_BYTES = 24;
const PASSWORD_KEYLEN = 64;

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function normalizeDisplayName(displayName, username) {
  const value = String(displayName || '').trim();
  return value || username;
}

function normalizePassword(password) {
  return String(password || '');
}

function validateUsername(username) {
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    const err = new Error('用户名需为 3-32 位，仅允许字母、数字、点、下划线和中划线');
    err.status = 400;
    throw err;
  }
}

function validatePassword(password) {
  if (password.length < 8) {
    const err = new Error('密码长度至少 8 位');
    err.status = 400;
    throw err;
  }
}

function makePasswordSalt() {
  return randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, PASSWORD_KEYLEN).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function makeTokenValue() {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('hex')}`;
}

function hashToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

function serializeAuthRow(row, token = null) {
  return {
    token,
    tokenId: row.token_id || row.id || null,
    tokenPrefix: row.token_prefix || null,
    user: {
      id: row.resolved_user_id || row.user_id || row.id || null,
      username: row.username,
      displayName: row.display_name || row.username,
      createdAt: row.user_created_at || row.created_at || null,
      updatedAt: row.user_updated_at || row.updated_at || null,
    },
  };
}

export function requireAuthContext(auth) {
  if (!auth?.tokenId || !auth?.user?.id) {
    const err = new Error('缺少认证上下文');
    err.status = 401;
    throw err;
  }
  return auth;
}

function ensureUserDataRoot(userId) {
  const root = join(PROJECT_ROOT, 'data', 'users', userId);
  mkdirSync(root, { recursive: true });
  return root;
}

export function getUserDataRoot(auth) {
  return ensureUserDataRoot(requireAuthContext(auth).user.id);
}

export function toScopedDataPath(auth, rawPath = '') {
  const userRoot = getUserDataRoot(auth);
  const normalized = String(rawPath || '')
    .replace(/^data\/users\/[^/]+\/?/, '')
    .replace(/^data\/?/, '')
    .replace(/^\/+/, '');
  const absolute = resolve(userRoot, normalized);
  const relToRoot = relative(userRoot, absolute);
  if (relToRoot.startsWith('..')) {
    const err = new Error('非法数据路径');
    err.status = 403;
    throw err;
  }
  return {
    userRoot,
    relativePath: relToRoot || '',
    absolutePath: absolute,
    projectRelativePath: relToRoot ? `data/users/${requireAuthContext(auth).user.id}/${relToRoot}` : `data/users/${requireAuthContext(auth).user.id}`,
    apiPath: relToRoot ? `data/${relToRoot}` : 'data',
  };
}

export function ensureScopedWorkspaceAccess(run, auth) {
  if (!run) {
    const err = new Error('Run not found');
    err.status = 404;
    throw err;
  }
  if (run.owner_user_id !== requireAuthContext(auth).user.id) {
    const err = new Error('无权限访问该诊断任务');
    err.status = 403;
    throw err;
  }
  return run;
}

export function getTokenScope(auth) {
  const resolved = requireAuthContext(auth);
  return {
    userId: resolved.user.id,
    tokenId: resolved.tokenId,
    username: resolved.user.username,
  };
}

export function makeScopedFolderKey(auth, folderName) {
  const { userId } = getTokenScope(auth);
  return `${userId}:${folderName}`;
}

function issueAuthToken(userId, label = 'default') {
  const token = makeTokenValue();
  const tokenId = randomUUID();
  const tokenHash = hashToken(token);
  const tokenPrefix = token.slice(0, 12);
  stmts.insertAuthToken.run({
    id: tokenId,
    userId,
    tokenHash,
    tokenPrefix,
    label,
  });
  ensureUserDataRoot(userId);
  return { token, tokenId };
}

export function authenticateAccessToken(token) {
  if (!token) return null;
  const row = stmts.getAuthTokenWithUserByHash.get(hashToken(token));
  if (!row) return null;
  stmts.touchAuthToken.run(row.token_id);
  ensureUserDataRoot(row.user_id);
  return serializeAuthRow(row, token);
}

export function registerUser({ username, password, displayName, tokenLabel = 'register' }) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedPassword = normalizePassword(password);
  validateUsername(normalizedUsername);
  validatePassword(normalizedPassword);

  const existing = stmts.getUserByUsername.get(normalizedUsername);
  if (existing) {
    const err = new Error('用户名已存在');
    err.status = 409;
    throw err;
  }

  const userId = randomUUID();
  const passwordSalt = makePasswordSalt();
  const passwordHash = hashPassword(normalizedPassword, passwordSalt);
  const firstUser = (stmts.countUsers.get()?.count || 0) === 0;

  const tx = db.transaction(() => {
    stmts.insertUser.run({
      id: userId,
      username: normalizedUsername,
      passwordHash,
      passwordSalt,
      displayName: normalizeDisplayName(displayName, normalizedUsername),
    });

    const issued = issueAuthToken(userId, tokenLabel);

    if (firstUser) {
      stmts.assignUnownedRunsToUser.run({ userId });
      stmts.assignUnownedFoldersToUser.run({ userId });
      stmts.assignUnownedChatsToUser.run({ userId });
    }

    return issued;
  });

  const issued = tx();
  const auth = authenticateAccessToken(issued.token);
  return {
    ...auth,
    token: issued.token,
  };
}

export function loginUser({ username, password, tokenLabel = 'login' }) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedPassword = normalizePassword(password);
  const user = stmts.getUserByUsername.get(normalizedUsername);
  if (!user || !verifyPassword(normalizedPassword, user.password_salt, user.password_hash)) {
    const err = new Error('用户名或密码错误');
    err.status = 401;
    throw err;
  }
  const issued = issueAuthToken(user.id, tokenLabel);
  const auth = authenticateAccessToken(issued.token);
  return {
    ...auth,
    token: issued.token,
  };
}

export function logoutToken(auth) {
  if (!auth?.tokenId) return false;
  stmts.revokeAuthToken.run(auth.tokenId);
  return true;
}
