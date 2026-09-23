import crypto from 'crypto';
import { db } from './db.js';

/**
 * Stateless signed-token auth for the Family Car app.
 *
 * Design notes:
 * - Tokens are HMAC-signed JSON (no DB round-trip, survives server restarts).
 * - Three privilege levels: family (passed the family code) -> user (picked a
 *   name) -> admin (passed the parent PIN).
 * - The client never receives a PIN or a PIN hash. Ever.
 */

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days - family device, long session

function getSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  // Derive a stable per-install secret so tokens survive restarts even when the
  // operator never set SESSION_SECRET.
  return db.getOrCreateInstallSecret();
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
}

export function issueToken({ userId = null, role = 'guest', adminUnlocked = false }) {
  const payload = {
    userId,
    role,
    adminUnlocked: !!adminUnlocked,
    exp: Date.now() + TOKEN_TTL_MS
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) return null;

  const expected = sign(payloadB64);
  // Constant-time compare to avoid leaking the signature byte by byte.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Attaches req.session when a valid token is present. Never rejects. */
export function attachSession(req, _res, next) {
  req.session = verifyToken(readToken(req));
  next();
}

/** Requires a token from someone who passed the family code. */
export function requireFamily(req, res, next) {
  if (!req.session) {
    return res.status(401).json({ error: 'נדרשת התחברות מחדש עם הקוד המשפחתי' });
  }
  next();
}

/** Requires a token bound to an actual family member. */
export function requireUser(req, res, next) {
  if (!req.session) {
    return res.status(401).json({ error: 'נדרשת התחברות מחדש עם הקוד המשפחתי' });
  }
  if (!req.session.userId) {
    return res.status(403).json({ error: 'יש לבחור מי אתה במשפחה כדי לבצע פעולה זו' });
  }
  const user = db.getUserById(req.session.userId);
  if (!user) {
    return res.status(403).json({ error: 'המשתמש שלך הוסר מהמערכת. בחר שם מחדש' });
  }
  req.user = user;
  next();
}

/** Requires a parent who actually entered the PIN on this device. */
export function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (req.user.role !== 'admin' || !req.session.adminUnlocked) {
      return res.status(403).json({ error: 'פעולה זו מיועדת להורים בלבד (נדרש קוד PIN)' });
    }
    next();
  });
}

// ----------------------------------------------------
// PIN hashing (scrypt) - PINs are never stored or sent in clear text
// ----------------------------------------------------
export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPin(pin, stored) {
  if (!stored || !pin) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  const candidate = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ----------------------------------------------------
// Brute-force throttling for the family code and the parent PIN
// ----------------------------------------------------
const attempts = new Map(); // key -> { count, firstAt, lockedUntil }
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 6;
const LOCK_MS = 15 * 60 * 1000;

export function checkThrottle(key) {
  const entry = attempts.get(key);
  if (!entry) return { allowed: true };
  if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
    const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return { allowed: false, minutes };
  }
  return { allowed: true };
}

export function registerFailure(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, lockedUntil: null });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCK_MS;
    entry.count = 0;
    entry.firstAt = now;
  }
}

export function clearFailures(key) {
  attempts.delete(key);
}

// Keep the throttle map from growing without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    const stale = now - entry.firstAt > WINDOW_MS;
    const unlocked = !entry.lockedUntil || entry.lockedUntil < now;
    if (stale && unlocked) attempts.delete(key);
  }
}, WINDOW_MS).unref();

/** Strips every secret from a user object before it leaves the server. */
export function publicUser(user, { includePhone = false } = {}) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    color: user.color,
    hasPin: !!user.pin_hash,
    ...(includePhone ? { phone: user.phone || '' } : {}),
    created_at: user.created_at
  };
}
