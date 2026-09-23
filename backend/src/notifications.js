import { db } from './db.js';
import { whatsappManager } from './whatsapp.js';

/**
 * The single notification layer for the app.
 *
 * Per PRD section 7, WhatsApp is the ONLY channel - there is deliberately no Web
 * Push here, because iOS PWAs cannot be relied on for it.
 *
 * Everything that announces something goes through this module so a feature can
 * never again *say* it notified someone without actually sending a message.
 */

const TZ = 'Asia/Jerusalem';

export function formatTime(value) {
  return new Date(value).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ
  });
}

export function formatDate(value) {
  return new Date(value).toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    timeZone: TZ
  });
}

export function formatRange(start, end) {
  const sameDay =
    new Date(start).toLocaleDateString('he-IL', { timeZone: TZ }) ===
    new Date(end).toLocaleDateString('he-IL', { timeZone: TZ });
  if (sameDay) {
    return formatDate(start) + ', ' + formatTime(start) + ' - ' + formatTime(end);
  }
  return (
    formatDate(start) + ' ' + formatTime(start) + ' עד ' + formatDate(end) + ' ' + formatTime(end)
  );
}

async function toGroup(message) {
  try {
    return await whatsappManager.sendGroupAnnouncement(message);
  } catch (err) {
    console.error('[Notify] Group announcement failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function toUser(user, message) {
  if (!user?.phone) {
    // No direct number on file - fall back to the group so the message is not lost.
    console.warn('[Notify] ' + (user?.name || 'user') + ' has no phone on file; sending to the group instead.');
    return toGroup('📢 ' + (user?.name ? user.name + ', ' : '') + message);
  }
  try {
    return await whatsappManager.sendMessage(user.phone, message);
  } catch (err) {
    console.error('[Notify] Direct message failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ----------------------------------------------------
// Reservation lifecycle
// ----------------------------------------------------
export async function announceNewReservation(reservation) {
  const lines = [
    '🚗 שריון רכב חדש',
    '👤 ' + reservation.user?.name,
    '📅 ' + formatRange(reservation.start_time, reservation.end_time),
    '🎯 ' + reservation.reason
  ];
  if (reservation.status === 'pending_approval') {
    lines.push('⏳ ממתין לאישור אבא/אמא (שריון ארוך)');
  }
  return toGroup(lines.join('\n'));
}

export async function announceQuickRide(reservation, minutes) {
  return toGroup(
    '⚡ ' + reservation.user?.name + ' לקח/ה את הרכב ל' + minutes + ' דקות' +
    '\n🎯 ' + reservation.reason +
    '\n🕐 חוזר/ת בסביבות ' + formatTime(reservation.end_time)
  );
}

export async function announceCancellation(reservation, { by } = {}) {
  const byLine = by && by !== reservation.user?.name ? ' (בוטל על ידי ' + by + ')' : '';
  return toGroup(
    '🗑️ השריון של ' + reservation.user?.name + ' בוטל' + byLine +
    '\n📅 ' + formatRange(reservation.start_time, reservation.end_time) +
    '\n✅ הרכב פנוי בזמן הזה'
  );
}

export async function announceReturn(reservation) {
  return toGroup(
    '🚗 ' + reservation.user?.name + ' החזיר/ה את הרכב' +
    '\n✅ הרכב פנוי מעכשיו (' + formatTime(new Date()) + ')'
  );
}

export async function announceApproval(reservation, approverName) {
  await toUser(
    reservation.user,
    '✅ הבקשה שלך אושרה על ידי ' + approverName + '!' +
    '\n📅 ' + formatRange(reservation.start_time, reservation.end_time) +
    '\n🎯 ' + reservation.reason
  );
  return toGroup(
    '✅ ' + approverName + ' אישר/ה את השריון הארוך של ' + reservation.user?.name +
    '\n📅 ' + formatRange(reservation.start_time, reservation.end_time)
  );
}

export async function announceRejection(reservation, approverName, reason) {
  return toUser(
    reservation.user,
    '❌ הבקשה שלך לשריון ארוך נדחתה על ידי ' + approverName + '.' +
    '\n📅 ' + formatRange(reservation.start_time, reservation.end_time) +
    (reason ? '\n💬 ' + reason : '') +
    '\nאפשר לבקש שוב עם זמנים אחרים.'
  );
}

/** Tells the parents a long request is waiting for them. */
export async function requestApproval(reservation) {
  const admins = db.getUsers().filter((u) => u.role === 'admin');
  const hours = (
    (new Date(reservation.end_time) - new Date(reservation.start_time)) / 3600000
  ).toFixed(1);

  const message =
    '⏳ בקשת שריון ארוך ממתינה לאישורך' +
    '\n👤 ' + reservation.user?.name +
    '\n📅 ' + formatRange(reservation.start_time, reservation.end_time) +
    '\n⌛ משך: ' + hours + ' שעות' +
    '\n🎯 ' + reservation.reason +
    '\n\nלאישור או דחייה: היכנס/י לאפליקציה > ניהול והגדרות > בקשות ממתינות';

  await Promise.all(admins.map((admin) => toUser(admin, message)));
  return { notifiedAdmins: admins.length };
}

// ----------------------------------------------------
// Waitlist (PRD section 5) - this is what actually sends the "it is free" DM
// ----------------------------------------------------
/**
 * Notifies everyone waiting on a window that just opened up, then marks them
 * notified so they are not pestered twice.
 * Returns the names actually messaged, so the caller can report the truth.
 */
export async function notifyWaitlist(freedStart, freedEnd, { freedBy } = {}) {
  const waiting = db.getWaitlistForSlot(freedStart, freedEnd);
  const notified = [];

  for (const entry of waiting) {
    const message =
      '🔔 הרכב התפנה!' +
      '\n📅 בזמן שביקשת: ' + formatRange(entry.target_start, entry.target_end) +
      (freedBy ? '\n👤 ' + freedBy + ' שחרר/ה את השריון' : '') +
      '\n\n🚗 מי שראשון מזמין - מקבל. אפשר לשריין באפליקציה או לשלוח כאן: "רכב ' +
      formatTime(entry.target_start) + ' עד ' + formatTime(entry.target_end) + '"';

    const result = await toUser(entry.user, message);
    // Only mark as notified when the send did not hard-fail, so a disconnected
    // bot does not silently swallow the alert forever.
    if (!result || result.success !== false) {
      db.markWaitlistNotified(entry.id);
      notified.push(entry.user.name);
    }
  }

  return { notified, count: notified.length };
}

// ----------------------------------------------------
// Daily digest (PRD section 7)
// ----------------------------------------------------
export async function sendDailyDigest() {
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const offset = -new Date().getTimezoneOffset();
  const reservations = db
    .getReservations({ date: todayLocal, tzOffsetMinutes: offset })
    .filter((r) => r.status === 'confirmed' || r.status === 'pending_approval');

  const header = '☀️ בוקר טוב משפחה 🚗\nלו״ז הרכב להיום (' + formatDate(new Date()) + '):\n';

  if (reservations.length === 0) {
    return toGroup(
      header + '\nהרכב פנוי לחלוטין היום, אין שריונים מתוכננים.' +
      '\n\nלשריון: שלחו כאן הודעה שמתחילה ב"רכב" או היכנסו לאפליקציה.'
    );
  }

  const lines = reservations.map((r, idx) => {
    const flag = r.status === 'pending_approval' ? ' ⏳(ממתין לאישור)' : '';
    return (
      idx + 1 + '. ' + formatTime(r.start_time) + '-' + formatTime(r.end_time) +
      ' | ' + r.user?.name + ' | ' + r.reason + flag
    );
  });

  const pending = reservations.filter((r) => r.status === 'pending_approval').length;
  const footer = pending > 0
    ? '\n⏳ ' + pending + ' בקשות ממתינות לאישור הורים.'
    : '\nנסיעה טובה ובטוחה לכולם! 🛣️';

  return toGroup(header + '\n' + lines.join('\n') + '\n' + footer);
}

// ----------------------------------------------------
// End-of-trip reminder (PRD section 7 - the critical edge case)
// ----------------------------------------------------
export async function sendEndOfTripReminder(reservation, nextReservation) {
  const settings = db.getSettings();
  const location = settings.default_location || 'הבית';

  let message =
    '⏰ ' + (reservation.user?.name || '') + ', השריון שלך על הרכב מסתיים בעוד 15 דקות (' +
    formatTime(reservation.end_time) + ').' +
    '\n⛽ אל תשכח/י לתדלק או לטעון את הרכב במידת הצורך!';

  // The conditional handoff append from the PRD.
  if (nextReservation) {
    message +=
      '\n\n⚠️ ' + (nextReservation.user?.name || 'המשתמש הבא') + ' מחכה לרכב מיד אחריך.' +
      '\n📍 נא להביא את הרכב ל' + location + ' עד ' + formatTime(nextReservation.start_time) + '.';
  }

  return toUser(reservation.user, message);
}
