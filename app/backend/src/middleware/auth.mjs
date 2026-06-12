import { authenticateAccessToken } from '../services/auth.service.mjs';

export function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  if (typeof req.query?.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return null;
}

export function authOptional(req, _res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    req.auth = null;
    return next();
  }

  const auth = authenticateAccessToken(token);
  req.auth = auth || null;
  return next();
}

export function authRequired(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: '缺少认证 token' });
  }

  const auth = authenticateAccessToken(token);
  if (!auth) {
    return res.status(401).json({ success: false, error: '认证 token 无效或已过期' });
  }

  req.auth = auth;
  return next();
}

export function getRequestAuth(req) {
  return req.auth || null;
}
