import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { hashPin } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'car_share.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// A reservation longer than this needs a parent's approval (PRD section 5).
export const APPROVAL_THRESHOLD_HOURS = 12;
// Guard rails so a typo cannot book the car for a decade.
const MAX_RESERVATION_HOURS = 24 * 14;
const MAX_FUTURE_DAYS = 365;
const MAX_TEXT_LENGTH = 280;

const DEFAULT_SETTINGS = {
  family_code: '1234',
  car_name: 'טויוטה קורולה משפחתית',
  car_plate: '12-345-67',
  default_location: 'חניה ראשית (בבית)',
  approval_threshold_hours: APPROVAL_THRESHOLD_HOURS,
  whatsapp_group_id: ''
};

function seedUsers() {
  const now = new Date().toISOString();
  return [
    { id: 'user-dad', name: 'אבא', role: 'admin', phone: '972501111111', color: '#0071E3', pin_hash: hashPin('1234'), created_at: now },
    { id: 'user-mom', name: 'אמא', role: 'admin', phone: '972502222222', color: '#AF52DE', pin_hash: hashPin('1234'), created_at: now },
    { id: 'user-yonatan', name: 'יונתן', role: 'member', phone: '972503333333', color: '#34C759', pin_hash: null, created_at: now },
    { id: 'user-noa', name: 'נועה', role: 'member', phone: '972504444444', color: '#FF9500', pin_hash: null, created_at: now },
    { id: 'user-omer', name: 'עומר', role: 'member', phone: '972505555555', color: '#FF2D55', pin_hash: null, created_at: now }
  ];
}

// ----------------------------------------------------
// Single in-memory state, persisted atomically.
// Every accessor works off `state`, so a request can never observe a
// half-applied change or re-parse the file in the middle of an operation.
// ----------------------------------------------------
let state = null;

function migrate(data) {
  let changed = false;

  data.users = Array.isArray(data.users) ? data.users : [];
  data.reservations = Array.isArray(data.reservations) ? data.reservations : [];
  data.waitlist = Array.isArray(data.waitlist) ? data.waitlist : [];
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };

  // Legacy clear-text PINs become scrypt hashes, then the column is dropped.
  for (const user of data.users) {
    if (user.pin_code) {
      user.pin_hash = hashPin(user.pin_code);
      delete user.pin_code;
      changed = true;
      console.log('[DB] Migrated a clear-text PIN for "' + user.name + '" to a scrypt hash.');
    } else if (Object.prototype.hasOwnProperty.call(user, 'pin_code')) {
      delete user.pin_code;
      changed = true;
    }
    if (user.pin_hash === undefined) {
      user.pin_hash = null;
      changed = true;
    }
  }

  // Per-install signing secret for session tokens.
  if (!data.install_secret) {
    data.install_secret = crypto.randomBytes(32).toString('hex');
    changed = true;
  }

  // Older rows predate these fields.
  for (const r of data.reservations) {
    if (r.notified_end === undefined) {
      r.notified_end = false;
      changed = true;
    }
  }
  for (const w of data.waitlist) {
    if (w.notified === undefined) {
      w.notified = false;
      changed = true;
    }
  }

  return changed;
}

function load() {
  if (state) return state;
  try {
    if (fs.existsSync(DB_FILE)) {
      state = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      if (migrate(state)) persist();
    } else {
      state = { users: seedUsers(), reservations: [], waitlist: [], settings: { ...DEFAULT_SETTINGS } };
      migrate(state);
      persist();
    }
  } catch (err) {
    console.error('[DB] Could not read the database file:', err.message);
    // Preserve the unreadable file instead of silently overwriting family data.
    if (fs.existsSync(DB_FILE)) {
      const backup = DB_FILE + '.corrupt-' + Date.now();
      try {
        fs.copyFileSync(DB_FILE, backup);
        console.error('[DB] The unreadable file was kept at ' + backup + '. Starting from seed data.');
      } catch {
        /* best effort */
      }
    }
    state = { users: seedUsers(), reservations: [], waitlist: [], settings: { ...DEFAULT_SETTINGS } };
    migrate(state);
    persist();
  }
  return state;
}

/** Atomic persist: write a temp file, then rename it over the original. */
function persist() {
  const tmp = DB_FILE + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_FILE);
    return true;
  } catch (err) {
    console.error('[DB] WRITE FAILED - the change was not saved:', err.message);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    // Surface the failure so the caller returns a real error instead of "saved".
    throw new Error('שמירת הנתונים נכשלה. נסה שוב בעוד רגע');
  }
}

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------
function cleanText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return fallback;
  return trimmed.slice(0, MAX_TEXT_LENGTH);
}

function parseTime(value, label) {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(label + ' אינה תאריך תקין');
  }
  return ms;
}

/** A reservation that actually occupies the car. Pending ones are only requests. */
function isBlocking(r) {
  return r.status === 'confirmed' || r.status === 'in_progress';
}

function withUser(r, usersMap) {
  const user = usersMap.get(r.user_id);
  return {
    ...r,
    user: user
      ? { id: user.id, name: user.name, role: user.role, color: user.color, phone: user.phone || '' }
      : { id: null, name: 'משתמש שהוסר', role: 'member', color: '#8E8E93', phone: '' }
  };
}

export const db = {
  getOrCreateInstallSecret() {
    const data = load();
    if (!data.install_secret) {
      data.install_secret = crypto.randomBytes(32).toString('hex');
      persist();
    }
    return data.install_secret;
  },

  // ----------------------------------------------------
  // Users
  // ----------------------------------------------------
  getUsers() {
    return load().users;
  },

  getUserById(id) {
    if (!id) return undefined;
    return load().users.find((u) => u.id === id);
  },

  /**
   * Exact match first, then a whole-word match.
   * The old version used includes(), so "אבא אמר לי לקחת את הרכב" resolved to
   * the user "אבא" and booked the car in a parent's name.
   */
  getUserByName(name) {
    if (!name || typeof name !== 'string') return null;
    const users = load().users;
    const clean = name.trim().toLowerCase();
    if (!clean) return null;

    const exact = users.find((u) => u.name.trim().toLowerCase() === clean);
    if (exact) return exact;

    const wordMatch = users.find((u) => {
      const uName = u.name.trim().toLowerCase();
      if (!uName) return false;
      const escaped = uName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(^|\\s)' + escaped + '($|\\s|,|\\.)').test(clean);
    });
    return wordMatch || null;
  },

  /**
   * Match on the last 9 digits (the Israeli subscriber number) so
   * 972501111111 / 0501111111 / +972-50-111-1111 all resolve to one person.
   * The old two-way endsWith() matched far too loosely.
   */
  getUserByPhone(phone) {
    if (!phone) return null;
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 9) return null;
    const tail = digits.slice(-9);
    return (
      load().users.find((u) => {
        const uDigits = (u.phone || '').replace(/\D/g, '');
        return uDigits.length >= 9 && uDigits.slice(-9) === tail;
      }) || null
    );
  },

  createUser({ name, role, phone, color, pin }) {
    const data = load();
    const cleanName = cleanText(name).slice(0, 40);
    if (!cleanName) throw new Error('שם הוא שדה חובה');

    if (data.users.some((u) => u.name.trim().toLowerCase() === cleanName.toLowerCase())) {
      throw new Error(cleanName + ' כבר קיים ברשימת המשפחה');
    }

    const cleanRole = role === 'admin' ? 'admin' : 'member';
    const newUser = {
      id: crypto.randomUUID(),
      name: cleanName,
      role: cleanRole,
      phone: String(phone || '').replace(/[^\d+]/g, '').slice(0, 20),
      color: /^#[0-9A-Fa-f]{6}$/.test(color || '') ? color : '#0071E3',
      pin_hash: cleanRole === 'admin' ? hashPin(pin || '1234') : null,
      created_at: new Date().toISOString()
    };
    data.users.push(newUser);
    persist();
    return newUser;
  },

  updateUser(id, { name, role, phone, color, pin }) {
    const data = load();
    const user = data.users.find((u) => u.id === id);
    if (!user) return null;

    if (name !== undefined) {
      const cleanName = cleanText(name).slice(0, 40);
      if (!cleanName) throw new Error('שם לא יכול להיות ריק');
      const clash = data.users.find(
        (u) => u.id !== id && u.name.trim().toLowerCase() === cleanName.toLowerCase()
      );
      if (clash) throw new Error('השם ' + cleanName + ' כבר תפוס');
      user.name = cleanName;
    }

    if (role !== undefined) {
      const cleanRole = role === 'admin' ? 'admin' : 'member';
      // Never leave the family without a parent who can approve and override.
      if (user.role === 'admin' && cleanRole === 'member') {
        const otherAdmins = data.users.filter((u) => u.id !== id && u.role === 'admin');
        if (otherAdmins.length === 0) {
          throw new Error('חייב להישאר לפחות הורה אחד עם הרשאות ניהול');
        }
      }
      user.role = cleanRole;
      if (cleanRole === 'member') user.pin_hash = null;
      if (cleanRole === 'admin' && !user.pin_hash) user.pin_hash = hashPin(pin || '1234');
    }

    if (phone !== undefined) {
      user.phone = String(phone || '').replace(/[^\d+]/g, '').slice(0, 20);
    }
    if (color !== undefined && /^#[0-9A-Fa-f]{6}$/.test(color)) {
      user.color = color;
    }
    if (pin) {
      if (!/^\d{4}$/.test(String(pin))) throw new Error('קוד PIN חייב להיות 4 ספרות');
      if (user.role !== 'admin') throw new Error('רק להורים יש קוד PIN');
      user.pin_hash = hashPin(pin);
    }

    persist();
    return user;
  },

  deleteUser(id) {
    const data = load();
    const user = data.users.find((u) => u.id === id);
    if (!user) return { removed: false, reason: 'משתמש לא נמצא' };

    if (user.role === 'admin') {
      const otherAdmins = data.users.filter((u) => u.id !== id && u.role === 'admin');
      if (otherAdmins.length === 0) {
        return { removed: false, reason: 'לא ניתן למחוק את ההורה היחיד עם הרשאות ניהול' };
      }
    }

    // Cancel their reservations instead of leaving orphaned rows behind.
    const now = Date.now();
    let cancelled = 0;
    for (const r of data.reservations) {
      if (r.user_id !== id) continue;
      if (r.status === 'cancelled' || r.status === 'completed') continue;
      if (new Date(r.end_time).getTime() > now) {
        r.status = 'cancelled';
        r.cancel_reason = 'המשתמש ' + user.name + ' הוסר מהמערכת';
        cancelled += 1;
      }
    }
    data.waitlist = data.waitlist.filter((w) => w.user_id !== id);
    data.users = data.users.filter((u) => u.id !== id);
    persist();
    return { removed: true, name: user.name, cancelledReservations: cancelled };
  },

  // ----------------------------------------------------
  // Reservations
  // ----------------------------------------------------
  /**
   * `date` is a local calendar day (YYYY-MM-DD) plus the client's UTC offset in
   * minutes, so "Thursday" means the family's Thursday - not UTC's.
   */
  getReservations({ date, tzOffsetMinutes = 0, startDate, endDate, status, includeCancelled = false } = {}) {
    const data = load();
    let list = [...data.reservations];

    if (date) {
      const offsetMs = Number(tzOffsetMinutes) * 60000;
      const dayStart = new Date(date + 'T00:00:00.000Z').getTime() - offsetMs;
      if (Number.isFinite(dayStart)) {
        const dayEnd = dayStart + 24 * 60 * 60 * 1000;
        list = list.filter((r) => {
          const s = new Date(r.start_time).getTime();
          const e = new Date(r.end_time).getTime();
          return s < dayEnd && e > dayStart; // any overlap with that local day
        });
      }
    }

    if (startDate && endDate) {
      const startMs = new Date(startDate).getTime();
      const endMs = new Date(endDate).getTime();
      if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
        list = list.filter((r) => {
          const s = new Date(r.start_time).getTime();
          const e = new Date(r.end_time).getTime();
          return s < endMs && e > startMs;
        });
      }
    }

    if (status) {
      list = list.filter((r) => r.status === status);
    } else if (!includeCancelled) {
      list = list.filter((r) => r.status !== 'cancelled');
    }

    const usersMap = new Map(data.users.map((u) => [u.id, u]));
    return list
      .map((r) => withUser(r, usersMap))
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  },

  getReservationById(id) {
    const data = load();
    const res = data.reservations.find((r) => r.id === id);
    if (!res) return null;
    return withUser(res, new Map(data.users.map((u) => [u.id, u])));
  },

  /**
   * Back-to-back is allowed on purpose (PRD section 5): an overlap needs
   * start < otherEnd AND end > otherStart, so end === otherStart is fine.
   *
   * Only confirmed reservations block. A pending request must not lock the car
   * for the whole family before a parent has approved it.
   */
  checkConflict(startTime, endTime, excludeReservationId = null) {
    const data = load();
    const reqStart = parseTime(startTime, 'שעת ההתחלה');
    const reqEnd = parseTime(endTime, 'שעת הסיום');

    if (reqStart >= reqEnd) {
      return { conflict: true, reason: 'שעת הסיום חייבת להיות מאוחרת משעת ההתחלה' };
    }

    const usersMap = new Map(data.users.map((u) => [u.id, u]));
    const blocking = data.reservations
      .filter((r) => isBlocking(r) && r.id !== excludeReservationId)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

    const conflicting = blocking.find((r) => {
      const s = new Date(r.start_time).getTime();
      const e = new Date(r.end_time).getTime();
      return reqStart < e && reqEnd > s;
    });

    if (!conflicting) return { conflict: false };

    // The real next opening: walk past every back-to-back reservation.
    let cursor = new Date(conflicting.end_time).getTime();
    let moved = true;
    while (moved) {
      moved = false;
      for (const r of blocking) {
        const s = new Date(r.start_time).getTime();
        const e = new Date(r.end_time).getTime();
        if (s <= cursor && e > cursor) {
          cursor = e;
          moved = true;
        }
      }
    }

    return {
      conflict: true,
      conflictingReservation: withUser(conflicting, usersMap),
      nextAvailable: new Date(cursor).toISOString()
    };
  },

  /** Shared validation for anything that creates or moves a reservation. */
  validateWindow(startTime, endTime, { allowPast = false } = {}) {
    const startMs = parseTime(startTime, 'שעת ההתחלה');
    const endMs = parseTime(endTime, 'שעת הסיום');
    const now = Date.now();

    if (endMs <= startMs) {
      throw new Error('שעת הסיום חייבת להיות מאוחרת משעת ההתחלה');
    }
    // Five minutes of slack so a slow tap on "now" does not fail.
    if (!allowPast && endMs < now - 5 * 60000) {
      throw new Error('לא ניתן לשריין זמן שכבר עבר');
    }
    const durationHours = (endMs - startMs) / 3600000;
    if (durationHours > MAX_RESERVATION_HOURS) {
      throw new Error('שריון בודד לא יכול לעלות על ' + MAX_RESERVATION_HOURS / 24 + ' ימים');
    }
    if (startMs > now + MAX_FUTURE_DAYS * 24 * 3600000) {
      throw new Error('לא ניתן לשריין יותר משנה מראש');
    }
    return { startMs, endMs, durationHours };
  },

  createReservation({ userId, startTime, endTime, reason, isQuickRide = false, notes = '', allowPast = false, source = 'app' }) {
    const data = load();
    const user = data.users.find((u) => u.id === userId);
    if (!user) throw new Error('משתמש לא נמצא במערכת');

    const { durationHours } = this.validateWindow(startTime, endTime, { allowPast });

    const conflictCheck = this.checkConflict(startTime, endTime);
    if (conflictCheck.conflict) {
      const err = new Error(
        conflictCheck.reason ||
          'הזמן תפוס על ידי ' + (conflictCheck.conflictingReservation?.user?.name || 'משתמש אחר')
      );
      err.code = 'CONFLICT';
      err.details = conflictCheck;
      throw err;
    }

    const threshold = Number(data.settings.approval_threshold_hours) || APPROVAL_THRESHOLD_HOURS;
    // A parent's own long trip does not need anyone's approval.
    const requiresApproval = durationHours > threshold && user.role !== 'admin';

    const newReservation = {
      id: crypto.randomUUID(),
      user_id: userId,
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      reason: cleanText(reason, isQuickRide ? 'קפיצה קצרה' : 'נסיעה כללית'),
      status: requiresApproval ? 'pending_approval' : 'confirmed',
      is_quick_ride: !!isQuickRide,
      notes: cleanText(notes),
      source,
      notified_end: false,
      created_at: new Date().toISOString()
    };

    data.reservations.push(newReservation);
    persist();

    const usersMap = new Map(data.users.map((u) => [u.id, u]));
    return { ...withUser(newReservation, usersMap), requiresApproval };
  },

  updateReservation(id, updates) {
    const data = load();
    const res = data.reservations.find((r) => r.id === id);
    if (!res) return null;

    if (updates.start_time || updates.end_time) {
      const newStart = updates.start_time || res.start_time;
      const newEnd = updates.end_time || res.end_time;
      const conflict = this.checkConflict(newStart, newEnd, id);
      if (conflict.conflict) {
        const err = new Error(
          conflict.reason ||
            'קיימת התנגשות עם השריון של ' + (conflict.conflictingReservation?.user?.name || 'משתמש אחר')
        );
        err.code = 'CONFLICT';
        err.details = conflict;
        throw err;
      }
    }

    Object.assign(res, updates);
    persist();
    return withUser(res, new Map(data.users.map((u) => [u.id, u])));
  },

  /**
   * Ends an active trip now, for the "I returned the car" button.
   * Shortening to `now` would put end before start on a future reservation, so a
   * trip that has not started yet is cancelled instead.
   */
  returnReservation(id) {
    const data = load();
    const res = data.reservations.find((r) => r.id === id);
    if (!res) return null;

    const usersMap = new Map(data.users.map((u) => [u.id, u]));
    if (res.status === 'completed') {
      return { alreadyReturned: true, reservation: withUser(res, usersMap) };
    }
    if (res.status === 'cancelled') {
      return { alreadyCancelled: true, reservation: withUser(res, usersMap) };
    }

    const now = Date.now();
    const startMs = new Date(res.start_time).getTime();
    const originalEnd = res.end_time;

    if (startMs > now) {
      res.status = 'cancelled';
      res.cancel_reason = 'בוטל לפני תחילת הנסיעה';
    } else {
      res.end_time = new Date(now).toISOString();
      res.status = 'completed';
    }
    res.returned_at = new Date(now).toISOString();
    persist();

    return {
      reservation: withUser(res, usersMap),
      freedFrom: new Date(now).toISOString(),
      freedUntil: originalEnd
    };
  },

  cancelReservation(id, { reason = '' } = {}) {
    const data = load();
    const res = data.reservations.find((r) => r.id === id);
    if (!res) return null;

    const usersMap = new Map(data.users.map((u) => [u.id, u]));
    if (res.status === 'cancelled') {
      return { alreadyCancelled: true, cancelled: withUser(res, usersMap), waitlist: [] };
    }

    res.status = 'cancelled';
    if (reason) res.cancel_reason = cleanText(reason);
    persist();

    return {
      cancelled: withUser(res, usersMap),
      waitlist: this.getWaitlistForSlot(res.start_time, res.end_time)
    };
  },

  /** Approving re-checks conflicts: the world may have moved on since the request. */
  approveReservation(id, approvedBy) {
    const data = load();
    const res = data.reservations.find((r) => r.id === id);
    if (!res) return null;
    if (res.status !== 'pending_approval') {
      throw new Error('שריון זה אינו ממתין לאישור');
    }

    const conflict = this.checkConflict(res.start_time, res.end_time, id);
    if (conflict.conflict) {
      const err = new Error(
        'לא ניתן לאשר - הזמן נתפס בינתיים על ידי ' +
          (conflict.conflictingReservation?.user?.name || 'משתמש אחר')
      );
      err.code = 'CONFLICT';
      err.details = conflict;
      throw err;
    }

    res.status = 'confirmed';
    res.approved_by = approvedBy || null;
    res.approved_at = new Date().toISOString();
    persist();
    return withUser(res, new Map(data.users.map((u) => [u.id, u])));
  },

  rejectReservation(id, { rejectedBy, reason = '' } = {}) {
    const data = load();
    const res = data.reservations.find((r) => r.id === id);
    if (!res) return null;
    if (res.status !== 'pending_approval') {
      throw new Error('שריון זה אינו ממתין לאישור');
    }
    res.status = 'cancelled';
    res.cancel_reason = cleanText(reason, 'הבקשה נדחתה על ידי הורה');
    res.rejected_by = rejectedBy || null;
    res.rejected_at = new Date().toISOString();
    persist();
    return withUser(res, new Map(data.users.map((u) => [u.id, u])));
  },

  getPendingApprovals() {
    return this.getReservations({ status: 'pending_approval' });
  },

  markEndReminderSent(id) {
    const data = load();
    const res = data.reservations.find((r) => r.id === id);
    if (res) {
      res.notified_end = true;
      persist();
    }
  },

  // ----------------------------------------------------
  // Waitlist
  // ----------------------------------------------------
  addToWaitlist({ userId, reservationId, targetStart, targetEnd }) {
    const data = load();
    if (!data.users.some((u) => u.id === userId)) {
      throw new Error('משתמש לא נמצא במערכת');
    }
    parseTime(targetStart, 'שעת ההתחלה');
    parseTime(targetEnd, 'שעת הסיום');

    const start = new Date(targetStart).toISOString();
    const end = new Date(targetEnd).toISOString();

    const existing = data.waitlist.find(
      (w) => w.user_id === userId && !w.notified && w.target_start === start && w.target_end === end
    );
    if (existing) return { entry: existing, alreadyWaiting: true };

    const entry = {
      id: crypto.randomUUID(),
      user_id: userId,
      reservation_id: reservationId || null,
      target_start: start,
      target_end: end,
      notified: false,
      created_at: new Date().toISOString()
    };
    data.waitlist.push(entry);
    persist();
    return { entry, alreadyWaiting: false };
  },

  getWaitlistForSlot(start, end) {
    const data = load();
    const sMs = new Date(start).getTime();
    const eMs = new Date(end).getTime();
    if (!Number.isFinite(sMs) || !Number.isFinite(eMs)) return [];

    const usersMap = new Map(data.users.map((u) => [u.id, u]));
    return data.waitlist
      .filter((w) => {
        if (w.notified) return false;
        const wStart = new Date(w.target_start).getTime();
        const wEnd = new Date(w.target_end).getTime();
        if (wEnd < Date.now()) return false; // the window already passed
        return wStart < eMs && wEnd > sMs;
      })
      .map((w) => ({ ...w, user: usersMap.get(w.user_id) || null }))
      .filter((w) => w.user);
  },

  getWaitlistEntries() {
    const data = load();
    const usersMap = new Map(data.users.map((u) => [u.id, u]));
    return data.waitlist
      .filter((w) => !w.notified && new Date(w.target_end).getTime() > Date.now())
      .map((w) => ({ ...w, user: usersMap.get(w.user_id) || null }))
      .filter((w) => w.user);
  },

  markWaitlistNotified(id) {
    const data = load();
    const item = data.waitlist.find((w) => w.id === id);
    if (item) {
      item.notified = true;
      item.notified_at = new Date().toISOString();
      persist();
    }
  },

  removeWaitlistEntry(id, userId) {
    const data = load();
    const before = data.waitlist.length;
    data.waitlist = data.waitlist.filter((w) => !(w.id === id && (!userId || w.user_id === userId)));
    if (data.waitlist.length !== before) {
      persist();
      return true;
    }
    return false;
  },

  // ----------------------------------------------------
  // Settings
  // ----------------------------------------------------
  getSettings() {
    return load().settings;
  },

  updateSettings(updates) {
    const data = load();
    const next = { ...data.settings };
    const allowed = [
      'family_code',
      'car_name',
      'car_plate',
      'default_location',
      'approval_threshold_hours',
      'whatsapp_group_id'
    ];

    for (const key of allowed) {
      if (updates[key] === undefined) continue;
      if (key === 'family_code') {
        const code = String(updates[key]).trim();
        if (!/^\d{4,12}$/.test(code)) throw new Error('הקוד המשפחתי חייב להיות בין 4 ל-12 ספרות');
        next.family_code = code;
      } else if (key === 'approval_threshold_hours') {
        const hours = Number(updates[key]);
        if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
          throw new Error('סף האישור חייב להיות בין שעה אחת ל-168 שעות');
        }
        next.approval_threshold_hours = hours;
      } else {
        next[key] = cleanText(updates[key], next[key] || '');
      }
    }

    data.settings = next;
    persist();
    return next;
  },

  // ----------------------------------------------------
  // Live status
  // ----------------------------------------------------
  getCurrentCarStatus() {
    const data = load();
    const now = Date.now();
    const usersMap = new Map(data.users.map((u) => [u.id, u]));

    const active = data.reservations.find((r) => {
      if (!isBlocking(r)) return false;
      const s = new Date(r.start_time).getTime();
      const e = new Date(r.end_time).getTime();
      return s <= now && e > now;
    });

    const upcoming = data.reservations
      .filter((r) => isBlocking(r) && new Date(r.start_time).getTime() > now)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))[0];

    return {
      isAvailable: !active,
      activeReservation: active ? withUser(active, usersMap) : null,
      nextReservation: upcoming ? withUser(upcoming, usersMap) : null,
      pendingCount: data.reservations.filter((r) => r.status === 'pending_approval').length
    };
  }
};
