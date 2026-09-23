import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { parseCarMessage } from './gemini.js';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Absolute path: LocalAuth used to resolve './.wwebjs_auth' against the current
// working directory, so starting the server from a different folder lost the
// saved session and forced a fresh QR scan.
const SESSION_PATH = path.join(__dirname, '..', '.wwebjs_auth');

const TRIGGER = 'רכב';
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000;

/**
 * WhatsApp client manager.
 *
 * PRD directive 2: whatsapp-web.js disconnects regularly, so this keeps the
 * session on disk, reconnects with exponential backoff, and never lets a client
 * error take down the HTTP server.
 */
class WhatsAppManager {
  constructor() {
    this.status = 'disconnected'; // disconnected | initializing | waiting_for_qr | connected
    this.qrDataUrl = null;
    this.client = null;
    this.lastLog = 'המערכת מוכנה לחיבור וואטסאפ בעת הצורך';
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.manualDisconnect = false;
    this.lastError = null;
    this.connectedAt = null;
    // Set lazily to avoid a circular import at module load time.
    this.onMessageHandler = null;
  }

  getStatus() {
    return {
      status: this.status,
      hasQr: !!this.qrDataUrl,
      qrDataUrl: this.qrDataUrl,
      lastLog: this.lastLog,
      lastError: this.lastError,
      isAutoStart: process.env.WHATSAPP_AUTO_START === 'true',
      groupId: this.getGroupId(),
      reconnectAttempts: this.reconnectAttempts,
      connectedAt: this.connectedAt
    };
  }

  getGroupId() {
    return process.env.WHATSAPP_FAMILY_GROUP_ID || db.getSettings().whatsapp_group_id || '';
  }

  async initClient() {
    if (this.client && (this.status === 'connected' || this.status === 'initializing')) {
      return { success: true, message: 'החיבור כבר פעיל או בתהליך', status: this.status };
    }

    this.manualDisconnect = false;
    this.clearReconnectTimer();

    try {
      this.status = 'initializing';
      this.lastError = null;
      this.lastLog = 'מאתחל שירות WhatsApp Web...';

      // whatsapp-web.js is CommonJS. A dynamic import() only surfaces `Client`
      // as a named export - LocalAuth lives on the default export, so
      // `const { Client, LocalAuth } = await import(...)` left LocalAuth
      // undefined and threw "LocalAuth is not a constructor".
      const mod = await import('whatsapp-web.js');
      const lib = mod.default ?? mod;
      const Client = lib.Client ?? mod.Client;
      const LocalAuth = lib.LocalAuth;

      if (typeof Client !== 'function' || typeof LocalAuth !== 'function') {
        throw new Error(
          'החבילה whatsapp-web.js לא נטענה כראוי (Client/LocalAuth חסרים). נסה: npm install whatsapp-web.js'
        );
      }

      this.client = new Client({
        authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
        takeoverOnConflict: true,
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu'
            // '--single-process' and '--no-zygote' were removed on purpose:
            // they make Chromium crash unpredictably under puppeteer, which was
            // a large part of why the bot kept dying.
          ]
        }
      });

      this.registerHandlers();

      // Do not await: initialize() only settles once the browser is fully up,
      // which can take a minute. The HTTP request should return immediately so
      // the UI can start polling for the QR code.
      this.client.initialize().catch((err) => {
        console.error('[WhatsApp] initialize() failed:', err.message);
        this.lastError = err.message;
        this.lastLog = 'שגיאה באתחול: ' + err.message;
        this.status = 'disconnected';
        this.client = null;
        this.scheduleReconnect();
      });

      return { success: true, message: 'אתחול וואטסאפ החל', status: this.status };
    } catch (err) {
      this.status = 'disconnected';
      this.client = null;
      this.lastError = err.message;
      this.lastLog = 'שגיאה באתחול: ' + err.message;
      console.error('[WhatsApp] Failed to initialize client:', err.message);
      return { success: false, error: err.message };
    }
  }

  registerHandlers() {
    this.client.on('qr', async (qr) => {
      this.status = 'waiting_for_qr';
      try {
        this.qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      } catch (err) {
        console.error('[WhatsApp] Could not render the QR code:', err.message);
      }
      this.lastLog = 'קוד QR מוכן לסריקה. סרוק מהוואטסאפ בנייד';
      console.log('[WhatsApp] QR code generated.');
    });

    this.client.on('ready', () => {
      this.status = 'connected';
      this.qrDataUrl = null;
      this.reconnectAttempts = 0;
      this.lastError = null;
      this.connectedAt = new Date().toISOString();
      this.lastLog = 'וואטסאפ מחובר בהצלחה ופעיל!';
      console.log('[WhatsApp] Client is ready and connected.');
    });

    this.client.on('authenticated', () => {
      this.lastLog = 'אימות וואטסאפ הצליח, מסיים התחברות...';
      console.log('[WhatsApp] Authenticated.');
    });

    this.client.on('auth_failure', (msg) => {
      this.status = 'disconnected';
      this.lastError = String(msg);
      this.lastLog = 'כישלון באימות: ' + msg + '. יש לסרוק QR מחדש';
      console.error('[WhatsApp] Auth failure:', msg);
      // A bad session will never fix itself by retrying - wait for a human.
      this.clearReconnectTimer();
    });

    this.client.on('disconnected', (reason) => {
      this.status = 'disconnected';
      this.qrDataUrl = null;
      this.connectedAt = null;
      this.lastLog = 'חיבור נותק (' + reason + ')';
      console.log('[WhatsApp] Disconnected:', reason);

      const dead = this.client;
      this.client = null;
      // Release the browser so the next attempt starts clean.
      Promise.resolve(dead?.destroy?.()).catch(() => {});

      if (String(reason).toUpperCase().includes('LOGOUT')) {
        this.lastLog = 'התנתקת מהמכשיר. יש לסרוק QR מחדש';
        return;
      }
      this.scheduleReconnect();
    });

    this.client.on('message', async (msg) => {
      try {
        await this.handleIncomingMessage(msg);
      } catch (err) {
        // A single bad message must never kill the listener.
        console.error('[WhatsApp] Error handling a message:', err.message);
      }
    });
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Exponential backoff, capped, and never after a deliberate disconnect. */
  scheduleReconnect() {
    if (this.manualDisconnect) return;
    this.clearReconnectTimer();

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.lastLog =
        'נכשלו ' + MAX_RECONNECT_ATTEMPTS + ' ניסיונות חיבור. לחץ "הפעל חיבור" לניסיון נוסף';
      console.error('[WhatsApp] Giving up after ' + MAX_RECONNECT_ATTEMPTS + ' attempts.');
      return;
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS
    );
    this.lastLog =
      'מנסה להתחבר מחדש בעוד ' + Math.round(delay / 1000) + ' שניות (ניסיון ' +
      this.reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ')';
    console.log('[WhatsApp] Reconnecting in ' + delay + 'ms (attempt ' + this.reconnectAttempts + ').');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.initClient();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  async disconnect() {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;

    if (this.client) {
      try {
        await this.client.destroy();
      } catch (err) {
        console.error('[WhatsApp] destroy() failed:', err.message);
      }
      this.client = null;
    }
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.connectedAt = null;
    this.lastLog = 'חיבור הוואטסאפ נותק בהצלחה';
    return { success: true };
  }

  // ----------------------------------------------------
  // Command processing (shared by real messages and the simulator)
  // ----------------------------------------------------
  /**
   * `trustedUserId` is set when the call comes from an authenticated app user
   * (the admin simulator). For real WhatsApp messages it is null and the sender
   * is resolved by phone number only.
   */
  async processCommand({ text, senderPhone = '', senderName = '', trustedUserId = null }) {
    const trimmed = String(text || '').trim();
    if (!trimmed.startsWith(TRIGGER)) {
      return null; // Not for us - stay quiet in the family group.
    }

    const familyUsers = db.getUsers();

    // Identity comes from the phone number. A display name is attacker-controlled
    // in WhatsApp, so it is never enough on its own to act as someone.
    let matchedUser = trustedUserId ? db.getUserById(trustedUserId) : null;
    if (!matchedUser) matchedUser = db.getUserByPhone(senderPhone);

    // An unrecognised sender can read, but never write. Previously a stranger's
    // "רכב בטל" cancelled another family member's reservation.
    if (!matchedUser) {
      const readOnly = await this.handleReadOnly(trimmed, familyUsers, senderName, senderPhone);
      if (readOnly) return readOnly;
      return {
        reply:
          '👋 היי! אני לא מזהה את המספר הזה כבן משפחה, ולכן אני לא יכול לשריין או לבטל בשמך.' +
          '\nהורה יכול להוסיף את המספר באפליקציה: ניהול והגדרות > משתמשים.' +
          '\n\nבינתיים אפשר לשאול אותי "רכב מי לוקח היום?" ואענה בשמחה.',
        parsed: { action: 'unknown_sender' },
        unknownSender: true
      };
    }

    const body = trimmed.slice(TRIGGER.length).trim();

    // Join the waitlist. The bot used to tell people to reply "רכב המתן" and
    // then had no handler for it at all.
    if (/^(המתן|תמתין|המתנה|רשימת המתנה|תודיע לי|הודע לי)/.test(body)) {
      return this.handleWaitlistRequest(matchedUser);
    }

    // "רכב בטל 2" - answering the numbered list this bot itself offers.
    // Every instruction the bot gives must have a handler behind it.
    const numberedCancel = body.match(/^(?:בטל|לבטל|תבטל|ביטול)\s+(\d)$/);
    if (numberedCancel) {
      return this.handleNumberedCancel(matchedUser, Number(numberedCancel[1]));
    }

    const parsed = await parseCarMessage({
      messageText: trimmed,
      senderPhone,
      senderName: matchedUser.name,
      familyUsers
    });

    if (parsed.action === 'status') return this.replyStatus(parsed);
    if (parsed.action === 'clarify') {
      return {
        reply:
          parsed.clarification_question ||
          'לאיזו שעה תרצה לשריין, ומתי בערך תחזיר? (למשל: "רכב מחר מ-18:00 עד 20:00")',
        parsed
      };
    }
    if (parsed.action === 'cancel') return this.handleCancel(matchedUser, parsed);
    if (parsed.action === 'reserve') return this.handleReserve(matchedUser, parsed);

    return {
      reply:
        'קיבלתי, אבל לא הבנתי בדיוק מה לעשות 🤔' +
        '\nנסה למשל: "רכב מחר מ-17:00 עד 19:00 לחוג", "רכב מי לוקח היום?", או "רכב בטל".',
      parsed
    };
  }

  /** The only thing a stranger may do: ask about status. */
  async handleReadOnly(trimmed, familyUsers, senderName, senderPhone) {
    const parsed = await parseCarMessage({
      messageText: trimmed,
      senderPhone,
      senderName,
      familyUsers
    });
    if (parsed.action === 'status') return this.replyStatus(parsed);
    return null;
  }

  replyStatus(parsed) {
    const { formatTime, formatDate } = this.fmt();
    const status = db.getCurrentCarStatus();

    if (!status.isAvailable) {
      const r = status.activeReservation;
      let reply =
        '🚗 הרכב כרגע אצל ' + (r.user?.name || 'מישהו') + ' עד ' + formatTime(r.end_time) +
        ' (' + (r.reason || 'נסיעה') + ').';
      if (status.nextReservation) {
        reply +=
          '\n➡️ אחר כך: ' + status.nextReservation.user?.name + ' ב-' +
          formatTime(status.nextReservation.start_time) + '.';
      }
      return { reply, parsed };
    }

    if (status.nextReservation) {
      const next = status.nextReservation;
      const sameDay =
        new Date(next.start_time).toDateString() === new Date().toDateString();
      return {
        reply:
          '✅ הרכב פנוי כרגע!' +
          '\n➡️ השריון הבא: ' + next.user?.name + ' ב-' +
          (sameDay ? formatTime(next.start_time) : formatDate(next.start_time) + ' ' + formatTime(next.start_time)) +
          '.',
        parsed
      };
    }

    return { reply: '✅ הרכב פנוי לחלוטין ואין שריונים מתוכננים. כל הזמנים פתוחים 🎉', parsed };
  }

  async handleWaitlistRequest(user) {
    const { formatTime, formatRange } = this.fmt();
    const status = db.getCurrentCarStatus();
    const target = status.activeReservation || status.nextReservation;

    if (!target) {
      return {
        reply: '✅ אין למה להמתין - הרכב פנוי עכשיו! אפשר לשריין ישר: "רכב עכשיו לשעתיים".',
        parsed: { action: 'waitlist' }
      };
    }

    try {
      const { alreadyWaiting } = db.addToWaitlist({
        userId: user.id,
        reservationId: target.id,
        targetStart: target.start_time,
        targetEnd: target.end_time
      });

      return {
        reply: alreadyWaiting
          ? '🔔 אתה כבר ברשימת ההמתנה לזמן הזה (' + formatRange(target.start_time, target.end_time) + '). אודיע לך ברגע שיתפנה.'
          : '🔔 נרשמת לרשימת ההמתנה!' +
            '\n📅 הזמן: ' + formatRange(target.start_time, target.end_time) +
            '\nברגע ש' + target.user?.name + ' יבטל או יחזיר מוקדם - אשלח לך הודעה אישית כאן.',
        parsed: { action: 'waitlist', target: target.id }
      };
    } catch (err) {
      return { reply: '⚠️ לא הצלחתי לרשום אותך לרשימת ההמתנה: ' + err.message, parsed: { action: 'waitlist' } };
    }
  }

  /** Resolves "רכב בטל 2" against the same ordering the bot listed. */
  async handleNumberedCancel(user, index) {
    const { formatRange } = this.fmt();
    const own = this.ownUpcoming(user);

    if (own.length === 0) {
      return { reply: 'לא מצאתי שריון פעיל או עתידי לביטול.', parsed: { action: 'cancel' } };
    }
    const target = own[index - 1];
    if (!target) {
      const list = own
        .slice(0, 5)
        .map((r, i) => i + 1 + '. ' + formatRange(r.start_time, r.end_time) + ' - ' + r.reason)
        .join('\n');
      return {
        reply: 'אין לי שריון במספר ' + index + '. אלה השריונים שלך:\n' + list,
        parsed: { action: 'cancel' }
      };
    }
    return this.performCancel(user, target);
  }

  /** The caller's own upcoming reservations, in the order the bot presents them. */
  ownUpcoming(user) {
    const now = Date.now();
    return db
      .getReservations()
      .filter(
        (r) =>
          r.user_id === user.id &&
          new Date(r.end_time).getTime() > now &&
          (r.status === 'confirmed' || r.status === 'pending_approval')
      );
  }

  async performCancel(user, target) {
    const { formatRange } = this.fmt();
    const result = db.cancelReservation(target.id, { reason: 'בוטל דרך וואטסאפ' });
    const { notifyWaitlist, announceCancellation } = await import('./notifications.js');

    await announceCancellation(result.cancelled, { by: user.name });
    const waitlistResult = await notifyWaitlist(target.start_time, target.end_time, {
      freedBy: user.name
    });

    let reply =
      '🗑️ ביטלתי את השריון:\n📅 ' + formatRange(target.start_time, target.end_time) +
      '\n🎯 ' + target.reason;
    if (waitlistResult.count > 0) {
      reply += '\n\n🔔 הודעתי ל' + waitlistResult.notified.join(', ') + ' שהזמן התפנה.';
    }
    return { reply, parsed: { action: 'cancel' }, cancelled: result.cancelled };
  }

  async handleCancel(user, parsed) {
    const { formatRange } = this.fmt();

    // Only ever the sender's own reservations. The old filter fell back to
    // "everyone" when the sender was unknown.
    const own = this.ownUpcoming(user);

    if (own.length === 0) {
      return { reply: 'לא מצאתי שריון פעיל או עתידי לביטול עבור ' + user.name + '.', parsed };
    }

    // More than one candidate: ask instead of guessing. Cancelling the wrong
    // trip silently is worse than one extra question.
    if (own.length > 1) {
      const list = own
        .slice(0, 5)
        .map((r, i) => i + 1 + '. ' + formatRange(r.start_time, r.end_time) + ' - ' + r.reason)
        .join('\n');
      return {
        reply:
          'יש לך ' + own.length + ' שריונים. איזה לבטל?\n' + list +
          '\n\nהשב עם המספר, למשל: "רכב בטל 1"',
        parsed,
        needsChoice: true,
        options: own.slice(0, 5).map((r) => r.id)
      };
    }

    return this.performCancel(user, own[0]);
  }

  async handleReserve(user, parsed) {
    const { formatTime, formatRange } = this.fmt();

    if (!parsed.start || !parsed.end) {
      return {
        reply:
          '⚠️ לא הצלחתי להבין את הזמנים. ציין שעת התחלה וסיום, למשל:' +
          '\n"רכב מחר מ-16:00 עד 18:00 לחוג"',
        parsed
      };
    }

    // Someone may ask on another family member's behalf, but only a parent may.
    let targetUser = user;
    if (parsed.user_name) {
      const named = db.getUserByName(parsed.user_name);
      if (named && named.id !== user.id) {
        if (user.role === 'admin') {
          targetUser = named;
        } else {
          return {
            reply:
              '🙋 אפשר לשריין רק בשם עצמך. אם זה בשביל ' + named.name +
              ', שהוא/היא ישלח/תשלח הודעה, או שאבא/אמא ישריינו.',
            parsed
          };
        }
      }
    }

    try {
      const reservation = db.createReservation({
        userId: targetUser.id,
        startTime: parsed.start,
        endTime: parsed.end,
        reason: parsed.reason,
        isQuickRide: !!parsed.is_quick_ride,
        source: 'whatsapp'
      });

      const { announceNewReservation, requestApproval } = await import('./notifications.js');
      await announceNewReservation(reservation);

      let reply =
        '✅ שריינתי עבור ' + targetUser.name + '!' +
        '\n📅 ' + formatRange(reservation.start_time, reservation.end_time) +
        '\n🎯 ' + reservation.reason;

      if (reservation.requiresApproval) {
        await requestApproval(reservation);
        reply +=
          '\n\n⏳ השריון ארוך מהרגיל, לכן הוא ממתין לאישור אבא/אמא. שלחתי להם הודעה.';
      }
      return { reply, parsed, reservation };
    } catch (err) {
      if (err.code === 'CONFLICT' && err.details?.conflictingReservation) {
        const c = err.details.conflictingReservation;
        return {
          reply:
            '⚠️ הזמן הזה תפוס על ידי ' + c.user?.name +
            ' (' + formatTime(c.start_time) + ' - ' + formatTime(c.end_time) + ').' +
            '\n🕐 הזמן הפנוי הקרוב: ' + formatTime(err.details.nextAvailable) + '.' +
            '\n\n🔔 רוצה שאודיע לך אם יתפנה? השב: "רכב המתן"',
          parsed,
          conflict: true
        };
      }
      return { reply: '⚠️ ' + err.message, parsed };
    }
  }

  fmt() {
    // Loaded lazily so notifications.js can import this module without a cycle.
    return {
      formatTime: (v) =>
        new Date(v).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' }),
      formatDate: (v) =>
        new Date(v).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' }),
      formatRange: (s, e) => {
        const t = (v) =>
          new Date(v).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
        const d = (v) =>
          new Date(v).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });
        return d(s) + ', ' + t(s) + ' - ' + t(e);
      }
    };
  }

  // ----------------------------------------------------
  // Real WhatsApp plumbing
  // ----------------------------------------------------
  async handleIncomingMessage(msg) {
    if (!msg.body || !msg.body.trim().startsWith(TRIGGER)) return;

    // Only listen to the family group (when one is configured) plus direct
    // messages, so the bot cannot be driven from an unrelated chat.
    const groupId = this.getGroupId();
    const chatId = msg.from || '';
    const isGroup = chatId.endsWith('@g.us');
    if (isGroup && groupId && chatId !== groupId) return;

    let senderPhone = '';
    let senderName = '';
    try {
      const contact = await msg.getContact();
      senderPhone = contact?.number || '';
      senderName = contact?.pushname || contact?.name || '';
    } catch (err) {
      console.error('[WhatsApp] Could not read the contact:', err.message);
      // Fall back to the raw sender id: "972501234567@c.us".
      senderPhone = String(msg.author || msg.from || '').split('@')[0];
    }

    const result = await this.processCommand({ text: msg.body, senderPhone, senderName });
    if (result?.reply) {
      try {
        await msg.reply(result.reply);
      } catch (err) {
        console.error('[WhatsApp] Could not reply:', err.message);
      }
    }
  }

  async sendMessage(to, message) {
    if (this.status !== 'connected' || !this.client) {
      console.log('[WhatsApp SIMULATED -> ' + to + ']: ' + message.replace(/\n/g, ' | '));
      return { simulated: true, to, message };
    }

    try {
      const formattedTo = String(to).includes('@')
        ? to
        : String(to).replace(/\D/g, '') + '@c.us';
      await this.client.sendMessage(formattedTo, message);
      return { success: true, to: formattedTo };
    } catch (err) {
      console.error('[WhatsApp] Send failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async sendGroupAnnouncement(message) {
    const groupId = this.getGroupId();
    if (!groupId) {
      console.log('[WhatsApp GROUP SIMULATED]: ' + message.replace(/\n/g, ' | '));
      return { simulated: true, message };
    }
    return this.sendMessage(groupId, message);
  }
}

export const whatsappManager = new WhatsAppManager();
