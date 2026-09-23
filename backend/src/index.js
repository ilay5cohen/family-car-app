import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db } from './db.js';
import { whatsappManager } from './whatsapp.js';
import { getDayStatus } from './hebcal.js';
import { initScheduler } from './scheduler.js';
import {
  attachSession,
  requireFamily,
  requireUser,
  requireAdmin,
  issueToken,
  verifyPin,
  publicUser,
  checkThrottle,
  registerFailure,
  clearFailures
} from './auth.js';
import {
  announceNewReservation,
  announceQuickRide,
  announceCancellation,
  announceReturn,
  announceApproval,
  announceRejection,
  requestApproval,
  notifyWaitlist,
  sendDailyDigest
} from './notifications.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ----------------------------------------------------
// Middleware
// ----------------------------------------------------
// CORS is restricted to the app's own origins. `cors()` with no options let any
// website on the internet call this API with the user's session.
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173,http://localhost:4173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// In development any loopback origin is fine - dev, preview and LAN testing all
// use different ports, and locking those out only trains people to disable CORS
// entirely. In production the allowlist is the allowlist.
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/;

function isOriginAllowed(origin) {
  if (allowedOrigins.includes(origin)) return true;
  if (!isProduction && LOOPBACK.test(origin)) return true;
  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin requests and native tooling send no Origin header.
      if (!origin) return callback(null, true);
      if (isOriginAllowed(origin)) return callback(null, true);
      return callback(new Error('Origin not allowed: ' + origin));
    },
    credentials: true
  })
);
app.use(express.json({ limit: '64kb' }));
app.use(attachSession);

/** Wraps an async handler so a rejected promise becomes a 500, not a hang. */
const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

/** Turns a thrown domain error into the right status code. */
function sendError(res, err, fallbackStatus = 400) {
  if (err.code === 'CONFLICT') {
    return res.status(409).json({ error: err.message, conflict: true, details: err.details || null });
  }
  return res.status(fallbackStatus).json({ error: err.message || 'שגיאה לא צפויה' });
}

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// ----------------------------------------------------
// Authentication
// ----------------------------------------------------
/** Step 1: the shared family code. Returns a family-level token. */
app.post('/api/auth/verify-code', (req, res) => {
  const key = 'code:' + clientKey(req);
  const throttle = checkThrottle(key);
  if (!throttle.allowed) {
    return res.status(429).json({
      error: 'יותר מדי ניסיונות. נסה שוב בעוד ' + throttle.minutes + ' דקות'
    });
  }

  const { code } = req.body || {};
  // The stored setting is the source of truth so an admin can actually change it.
  // FAMILY_CODE in .env is only the initial value, used before any setting exists.
  const expected = String(db.getSettings().family_code || process.env.FAMILY_CODE || '1234').trim();

  if (code && String(code).trim() === expected) {
    clearFailures(key);
    return res.json({ success: true, token: issueToken({ role: 'guest' }) });
  }

  registerFailure(key);
  return res.status(401).json({ success: false, error: 'קוד משפחתי שגוי' });
});

/** Step 2: pick who you are. Members are done here; parents still need the PIN. */
app.post('/api/auth/select-user', requireFamily, (req, res) => {
  const { userId } = req.body || {};
  const user = db.getUserById(userId);
  if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });

  // A parent account cannot be entered without the PIN. The old client had a
  // "continue without a PIN" button that logged you in as אבא regardless.
  if (user.role === 'admin') {
    return res.status(403).json({
      error: 'כדי להיכנס כהורה יש להזין קוד PIN',
      requiresPin: true,
      userId: user.id
    });
  }

  return res.json({
    success: true,
    token: issueToken({ userId: user.id, role: user.role, adminUnlocked: false }),
    user: publicUser(user)
  });
});

/** Step 3: the parent PIN. Also used to unlock the admin panel later. */
app.post('/api/auth/verify-pin', requireFamily, (req, res) => {
  const { userId, pin } = req.body || {};
  const key = 'pin:' + clientKey(req) + ':' + (userId || '');
  const throttle = checkThrottle(key);
  if (!throttle.allowed) {
    return res.status(429).json({
      error: 'יותר מדי ניסיונות. נסה שוב בעוד ' + throttle.minutes + ' דקות'
    });
  }

  const user = db.getUserById(userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'משתמש זה אינו הורה במערכת' });
  }

  if (pin && verifyPin(String(pin).trim(), user.pin_hash)) {
    clearFailures(key);
    return res.json({
      success: true,
      token: issueToken({ userId: user.id, role: 'admin', adminUnlocked: true }),
      user: publicUser(user)
    });
  }

  registerFailure(key);
  return res.status(401).json({ success: false, error: 'קוד PIN שגוי' });
});

/** Lets the client confirm its stored token is still valid on startup. */
app.get('/api/auth/me', (req, res) => {
  if (!req.session) return res.status(401).json({ authenticated: false });
  const user = req.session.userId ? db.getUserById(req.session.userId) : null;
  if (req.session.userId && !user) {
    return res.status(401).json({ authenticated: false, error: 'המשתמש הוסר מהמערכת' });
  }
  return res.json({
    authenticated: true,
    familyVerified: true,
    user: user ? publicUser(user) : null,
    isAdminUnlocked: !!req.session.adminUnlocked && user?.role === 'admin'
  });
});

// ----------------------------------------------------
// Status
// ----------------------------------------------------
app.get('/api/status', requireFamily, (req, res) => {
  const status = db.getCurrentCarStatus();
  const settings = db.getSettings();
  res.json({
    ...status,
    carName: settings.car_name,
    carPlate: settings.car_plate,
    defaultLocation: settings.default_location,
    approvalThresholdHours: settings.approval_threshold_hours
  });
});

// ----------------------------------------------------
// Users
// ----------------------------------------------------
/**
 * The user list is needed on the login screen, so it is family-gated rather than
 * user-gated - but it never includes a PIN hash, and phone numbers are only
 * exposed to an unlocked parent. The old endpoint returned `pin_code: "1234"`
 * in clear text to anyone who asked.
 */
app.get('/api/users', requireFamily, (req, res) => {
  const isAdmin = !!req.session.adminUnlocked;
  res.json(db.getUsers().map((u) => publicUser(u, { includePhone: isAdmin })));
});

app.post('/api/users', requireAdmin, (req, res) => {
  try {
    const { name, role, phone, color, pin } = req.body || {};
    const newUser = db.createUser({ name, role, phone, color, pin });
    res.status(201).json(publicUser(newUser, { includePhone: true }));
  } catch (err) {
    sendError(res, err);
  }
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  try {
    const { name, role, phone, color, pin } = req.body || {};
    const updated = db.updateUser(req.params.id, { name, role, phone, color, pin });
    if (!updated) return res.status(404).json({ error: 'משתמש לא נמצא' });
    res.json(publicUser(updated, { includePhone: true }));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'לא ניתן למחוק את עצמך' });
    }
    const result = db.deleteUser(req.params.id);
    if (!result.removed) return res.status(400).json({ error: result.reason });
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

// ----------------------------------------------------
// Reservations
// ----------------------------------------------------
app.get('/api/reservations', requireFamily, (req, res) => {
  const { date, tzOffsetMinutes, startDate, endDate, status } = req.query;
  res.json(
    db.getReservations({
      date,
      tzOffsetMinutes: Number(tzOffsetMinutes) || 0,
      startDate,
      endDate,
      status
    })
  );
});

app.get('/api/reservations/pending', requireAdmin, (req, res) => {
  res.json(db.getPendingApprovals());
});

app.post(
  '/api/reservations',
  requireUser,
  asyncRoute(async (req, res) => {
    try {
      const { startTime, endTime, reason, notes, userId } = req.body || {};
      if (!startTime || !endTime) {
        return res.status(400).json({ error: 'חסרות שעת התחלה או שעת סיום' });
      }

      // You book for yourself. Only a parent may book on someone else's behalf.
      let targetUserId = req.user.id;
      if (userId && userId !== req.user.id) {
        if (!req.session.adminUnlocked || req.user.role !== 'admin') {
          return res.status(403).json({ error: 'רק הורה יכול לשריין עבור בן משפחה אחר' });
        }
        targetUserId = userId;
      }

      const reservation = db.createReservation({
        userId: targetUserId,
        startTime,
        endTime,
        reason,
        notes,
        source: 'app'
      });

      await announceNewReservation(reservation);
      if (reservation.requiresApproval) {
        await requestApproval(reservation);
      }

      res.status(201).json(reservation);
    } catch (err) {
      sendError(res, err);
    }
  })
);

/** Quick action: "I took the car for a few minutes". */
app.post(
  '/api/reservations/quick',
  requireUser,
  asyncRoute(async (req, res) => {
    try {
      const minutes = Math.min(Math.max(Number(req.body?.minutes) || 15, 5), 60);
      const reason = req.body?.reason || 'קפיצה קצרה';

      const now = new Date();
      const reservation = db.createReservation({
        userId: req.user.id,
        startTime: now.toISOString(),
        endTime: new Date(now.getTime() + minutes * 60000).toISOString(),
        reason,
        isQuickRide: true,
        allowPast: true, // starts "now", which is a hair in the past by the time it lands
        source: 'app'
      });

      await announceQuickRide(reservation, minutes);
      res.status(201).json(reservation);
    } catch (err) {
      sendError(res, err);
    }
  })
);

/** Quick action: "I returned the car" - frees the slot early. */
app.post(
  '/api/reservations/return',
  requireUser,
  asyncRoute(async (req, res) => {
    try {
      const { reservationId } = req.body || {};

      let target = null;
      if (reservationId) {
        target = db.getReservationById(reservationId);
        if (!target) return res.status(404).json({ error: 'שריון לא נמצא' });
      } else {
        target = db.getCurrentCarStatus().activeReservation;
        if (!target) return res.status(404).json({ error: 'לא נמצא שריון פעיל להחזרה' });
      }

      // Only the driver, or a parent overriding, may end a trip.
      const isOwner = target.user_id === req.user.id;
      const isAdmin = req.user.role === 'admin' && req.session.adminUnlocked;
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: 'רק מי שלקח את הרכב (או הורה) יכול לסמן החזרה' });
      }

      const result = db.returnReservation(target.id);
      if (!result) return res.status(404).json({ error: 'שריון לא נמצא' });
      if (result.alreadyReturned) {
        return res.json({ success: true, message: 'הרכב כבר סומן כמוחזר', reservation: result.reservation });
      }
      if (result.alreadyCancelled) {
        return res.json({ success: true, message: 'השריון כבר בוטל', reservation: result.reservation });
      }

      await announceReturn(result.reservation);
      // This is the part that was missing: actually telling the people waiting.
      const waitlistResult = await notifyWaitlist(result.freedFrom, result.freedUntil, {
        freedBy: result.reservation.user?.name
      });

      res.json({
        success: true,
        message: 'הרכב הוחזר בהצלחה וזמין לשימוש',
        reservation: result.reservation,
        waitlistNotified: waitlistResult.count,
        waitlistNames: waitlistResult.notified
      });
    } catch (err) {
      sendError(res, err, 500);
    }
  })
);

app.put(
  '/api/reservations/:id/approve',
  requireAdmin,
  asyncRoute(async (req, res) => {
    try {
      const updated = db.approveReservation(req.params.id, req.user.name);
      if (!updated) return res.status(404).json({ error: 'שריון לא נמצא' });
      await announceApproval(updated, req.user.name);
      res.json(updated);
    } catch (err) {
      sendError(res, err);
    }
  })
);

app.put(
  '/api/reservations/:id/reject',
  requireAdmin,
  asyncRoute(async (req, res) => {
    try {
      const rejected = db.rejectReservation(req.params.id, {
        rejectedBy: req.user.name,
        reason: req.body?.reason
      });
      if (!rejected) return res.status(404).json({ error: 'שריון לא נמצא' });
      await announceRejection(rejected, req.user.name, req.body?.reason);
      res.json(rejected);
    } catch (err) {
      sendError(res, err);
    }
  })
);

app.delete(
  '/api/reservations/:id',
  requireUser,
  asyncRoute(async (req, res) => {
    try {
      const existing = db.getReservationById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'שריון לא נמצא' });

      // A member can only cancel their own booking; a parent can override anyone.
      const isOwner = existing.user_id === req.user.id;
      const isAdmin = req.user.role === 'admin' && req.session.adminUnlocked;
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: 'אפשר לבטל רק שריון שלך (או כהורה עם קוד PIN)' });
      }

      const result = db.cancelReservation(req.params.id, { reason: req.body?.reason });
      if (result.alreadyCancelled) {
        return res.json({ success: true, message: 'השריון כבר בוטל', cancelled: result.cancelled });
      }

      await announceCancellation(result.cancelled, { by: req.user.name });
      const waitlistResult = await notifyWaitlist(existing.start_time, existing.end_time, {
        freedBy: existing.user?.name
      });

      res.json({
        success: true,
        cancelled: result.cancelled,
        waitlistNotified: waitlistResult.count,
        waitlistNames: waitlistResult.notified
      });
    } catch (err) {
      sendError(res, err, 500);
    }
  })
);

// ----------------------------------------------------
// Waitlist
// ----------------------------------------------------
app.get('/api/waitlist', requireUser, (req, res) => {
  const all = db.getWaitlistEntries();
  const isAdmin = req.user.role === 'admin' && req.session.adminUnlocked;
  res.json(
    (isAdmin ? all : all.filter((w) => w.user_id === req.user.id)).map((w) => ({
      id: w.id,
      user: publicUser(w.user),
      target_start: w.target_start,
      target_end: w.target_end,
      created_at: w.created_at
    }))
  );
});

app.post('/api/waitlist', requireUser, (req, res) => {
  try {
    const { reservationId, targetStart, targetEnd } = req.body || {};
    if (!targetStart || !targetEnd) {
      return res.status(400).json({ error: 'חסרים זמני ההמתנה' });
    }
    // Always the requesting user - never a userId from the body.
    const { entry, alreadyWaiting } = db.addToWaitlist({
      userId: req.user.id,
      reservationId,
      targetStart,
      targetEnd
    });
    res.status(alreadyWaiting ? 200 : 201).json({ ...entry, alreadyWaiting });
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/waitlist/:id', requireUser, (req, res) => {
  const isAdmin = req.user.role === 'admin' && req.session.adminUnlocked;
  const removed = db.removeWaitlistEntry(req.params.id, isAdmin ? null : req.user.id);
  if (!removed) return res.status(404).json({ error: 'רשומה לא נמצאה' });
  res.json({ success: true });
});

// ----------------------------------------------------
// Jewish calendar
// ----------------------------------------------------
app.get(
  '/api/calendar/day-status',
  requireFamily,
  asyncRoute(async (req, res) => {
    try {
      const status = await getDayStatus(req.query.date);
      res.json(status);
    } catch (err) {
      // Never let a calendar outage break the schedule screen.
      res.json({
        date: req.query.date || null,
        isShabbat: false,
        isYomTov: false,
        isDrivingRestricted: false,
        restrictedFrom: null,
        restrictedUntil: null,
        title: '',
        error: err.message
      });
    }
  })
);

// ----------------------------------------------------
// Settings
// ----------------------------------------------------
/** Read-only view for every family member (no secrets here). */
app.get('/api/settings', requireFamily, (req, res) => {
  const settings = db.getSettings();
  const isAdmin = !!req.session.adminUnlocked;
  if (!isAdmin) {
    // The family code is a secret even from members who are already inside.
    const { family_code, whatsapp_group_id, ...safe } = settings;
    return res.json(safe);
  }
  res.json(settings);
});

app.put('/api/settings', requireAdmin, (req, res) => {
  try {
    res.json(db.updateSettings(req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

/** Lets a parent change their own PIN. */
app.put('/api/settings/pin', requireAdmin, (req, res) => {
  try {
    const { currentPin, newPin } = req.body || {};
    if (!verifyPin(String(currentPin || '').trim(), req.user.pin_hash)) {
      return res.status(401).json({ error: 'קוד ה-PIN הנוכחי שגוי' });
    }
    if (!/^\d{4}$/.test(String(newPin || ''))) {
      return res.status(400).json({ error: 'קוד PIN חדש חייב להיות 4 ספרות' });
    }
    db.updateUser(req.user.id, { pin: String(newPin) });
    res.json({ success: true, message: 'קוד ה-PIN עודכן בהצלחה' });
  } catch (err) {
    sendError(res, err);
  }
});

// ----------------------------------------------------
// WhatsApp bot
// ----------------------------------------------------
app.get('/api/whatsapp/status', requireAdmin, (req, res) => {
  res.json(whatsappManager.getStatus());
});

app.post(
  '/api/whatsapp/connect',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await whatsappManager.initClient());
  })
);

app.post(
  '/api/whatsapp/disconnect',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await whatsappManager.disconnect());
  })
);

/** Dry-run the NLP engine without a connected phone. */
app.post(
  '/api/whatsapp/simulate',
  requireAdmin,
  asyncRoute(async (req, res) => {
    try {
      const { text, asUserId } = req.body || {};
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: 'יש להזין טקסט להודעה (למשל: רכב מחר מ-18:00 עד 20:00)' });
      }

      // The simulator acts as a chosen family member. `asUserId` is trusted here
      // because only an unlocked parent can reach this route.
      const asUser = asUserId ? db.getUserById(asUserId) : null;
      const result = await whatsappManager.processCommand({
        text,
        senderPhone: asUser?.phone || '',
        senderName: asUser?.name || '',
        trustedUserId: asUser?.id || null
      });

      res.json(
        result || {
          reply: 'ההודעה אינה מתחילה במילה "רכב", ולכן הבוט מתעלם ממנה (כך הוא לא מפריע בקבוצה).',
          ignored: true
        }
      );
    } catch (err) {
      sendError(res, err, 500);
    }
  })
);

/** Send the morning digest now, for testing the notification path. */
app.post(
  '/api/whatsapp/test-digest',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const result = await sendDailyDigest();
    res.json({ success: true, result });
  })
);

// ----------------------------------------------------
// Errors
// ----------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'נתיב לא קיים: ' + req.method + ' ' + req.path });
});

app.use((err, req, res, _next) => {
  if (String(err.message).startsWith('Origin not allowed')) {
    return res.status(403).json({ error: 'בקשה ממקור לא מורשה' });
  }
  console.error('[API] Unhandled error on ' + req.method + ' ' + req.path + ':', err);
  res.status(500).json({ error: 'שגיאת שרת פנימית' });
});

// ----------------------------------------------------
// Start
// ----------------------------------------------------
const server = app.listen(PORT, () => {
  console.log('Family Car backend listening on http://localhost:' + PORT);
  console.log('Allowed origins: ' + allowedOrigins.join(', ') + (isProduction ? '' : ' (+ any loopback, development only)'));
  initScheduler();

  if (process.env.WHATSAPP_AUTO_START === 'true') {
    whatsappManager.initClient();
  }
});

// A crash in a background job must not leave the process in a zombie state.
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection:', reason);
});

function shutdown(signal) {
  console.log('[Process] ' + signal + ' received, shutting down.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
