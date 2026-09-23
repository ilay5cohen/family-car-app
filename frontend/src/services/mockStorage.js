/**
 * Local in-browser storage and simulation engine for Family Car App.
 * Enables the complete app to run seamlessly on static hosts (like GitHub Pages)
 * with zero server dependencies, preserving all state in localStorage.
 */

const STORAGE_KEY = 'family_car_local_db_v1';

const DEFAULT_USERS = [
  { id: 'user-dad', name: 'אבא', role: 'admin', phone: '050-1111111', color: '#0071E3' },
  { id: 'user-mom', name: 'אמא', role: 'admin', phone: '050-2222222', color: '#AF52DE' },
  { id: 'user-yonatan', name: 'יונתן', role: 'member', phone: '050-3333333', color: '#34C759' },
  { id: 'user-noa', name: 'נועה', role: 'member', phone: '050-4444444', color: '#FF9500' },
  { id: 'user-omer', name: 'עומר', role: 'member', phone: '050-5555555', color: '#FF2D55' }
];

const DEFAULT_SETTINGS = {
  family_code: '1234',
  car_name: 'טויוטה קורולה משפחתית',
  car_plate: '12-345-67',
  default_location: 'חניה ראשית (בבית)',
  approval_threshold_hours: 12,
  whatsapp_group_id: ''
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function initialSeed() {
  const today = getTodayString();
  return {
    settings: { ...DEFAULT_SETTINGS },
    users: [...DEFAULT_USERS],
    reservations: [
      {
        id: 'res-demo-1',
        user_id: 'user-yonatan',
        user_name: 'יונתן',
        user_color: '#34C759',
        start_time: `${today}T10:00:00`,
        end_time: `${today}T12:00:00`,
        reason: 'נסיעה לאוניברסיטה ולספרייה',
        destination: 'אוניברסיטת תל אביב',
        location: 'חניה ראשית (בבית)',
        status: 'approved',
        created_at: new Date().toISOString()
      },
      {
        id: 'res-demo-2',
        user_id: 'user-mom',
        user_name: 'אמא',
        user_color: '#AF52DE',
        start_time: `${today}T16:30:00`,
        end_time: `${today}T18:00:00`,
        reason: 'קניות שבועיות בסופר',
        destination: 'מרכז שרונה',
        location: 'חניה ראשית (בבית)',
        status: 'approved',
        created_at: new Date().toISOString()
      }
    ],
    waitlist: []
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = initialSeed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw);
    if (!parsed.reservations || !parsed.users) {
      const seeded = initialSeed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return parsed;
  } catch {
    return initialSeed();
  }
}

function saveDB(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
  }
}

export const mockStorage = {
  // Auth
  verifyFamilyCode(code) {
    const db = loadDB();
    if (code === db.settings.family_code) {
      return { ok: true, token: 'demo-family-token' };
    }
    throw new Error('קוד משפחתי שגוי');
  },

  selectUser(userId) {
    const db = loadDB();
    const user = db.users.find((u) => u.id === userId);
    if (!user) throw new Error('משתמש לא נמצא');
    const token = `demo-token-${user.id}`;
    localStorage.setItem('demo_current_user_id', user.id);
    return { ok: true, token, user };
  },

  verifyAdminPin(userId, pin) {
    const db = loadDB();
    const user = db.users.find((u) => u.id === userId);
    if (!user) throw new Error('משתמש לא נמצא');
    if (user.role !== 'admin') throw new Error('משתמש אינו מנהל');
    if (pin === '1234') {
      const token = `demo-token-admin-${user.id}`;
      localStorage.setItem('demo_current_user_id', user.id);
      return { ok: true, token, user, admin: true };
    }
    throw new Error('קוד PIN שגוי');
  },

  me() {
    const db = loadDB();
    const uid = localStorage.getItem('demo_current_user_id');
    const user = db.users.find((u) => u.id === uid) || null;
    return {
      familyVerified: true,
      user,
      isAdminUnlocked: user?.role === 'admin'
    };
  },

  // Users
  getUsers() {
    return loadDB().users;
  },

  createUser(userData) {
    const db = loadDB();
    const newUser = {
      id: `user-${Date.now()}`,
      name: userData.name,
      role: userData.role || 'member',
      phone: userData.phone || '',
      color: userData.color || '#0071E3'
    };
    db.users.push(newUser);
    saveDB(db);
    return newUser;
  },

  updateUser(id, updates) {
    const db = loadDB();
    const idx = db.users.findIndex((u) => u.id === id);
    if (idx === -1) throw new Error('משתמש לא נמצא');
    db.users[idx] = { ...db.users[idx], ...updates };
    saveDB(db);
    return db.users[idx];
  },

  deleteUser(id) {
    const db = loadDB();
    db.users = db.users.filter((u) => u.id !== id);
    saveDB(db);
    return { ok: true };
  },

  // Status & Reservations
  getCarStatus() {
    const db = loadDB();
    const now = new Date();
    const nowISO = now.toISOString();

    const activeRes = db.reservations.find((r) => {
      if (r.status !== 'approved') return false;
      const s = new Date(r.start_time);
      const e = new Date(r.end_time);
      return now >= s && now <= e;
    });

    if (activeRes) {
      return {
        isAvailable: false,
        currentReservation: activeRes,
        currentDriver: db.users.find((u) => u.id === activeRes.user_id) || { name: activeRes.user_name },
        location: activeRes.destination || db.settings.default_location,
        returnTime: activeRes.end_time
      };
    }

    const nextRes = db.reservations
      .filter((r) => r.status === 'approved' && new Date(r.start_time) > now)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))[0];

    return {
      isAvailable: true,
      currentDriver: null,
      location: db.settings.default_location,
      nextReservation: nextRes || null
    };
  },

  getReservations(params = {}) {
    const db = loadDB();
    let list = [...db.reservations];

    if (params.date) {
      list = list.filter((r) => r.start_time.startsWith(params.date));
    }
    if (params.userId) {
      list = list.filter((r) => r.user_id === params.userId);
    }
    if (params.status) {
      list = list.filter((r) => r.status === params.status);
    }
    list.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    return list;
  },

  getPendingApprovals() {
    const db = loadDB();
    return db.reservations.filter((r) => r.status === 'pending_approval');
  },

  createReservation(data) {
    const db = loadDB();
    const uid = localStorage.getItem('demo_current_user_id') || 'user-dad';
    const user = db.users.find((u) => u.id === uid) || db.users[0];

    const start = new Date(data.start_time);
    const end = new Date(data.end_time);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('זמני ההזמנה אינם תקינים');
    }
    if (end <= start) {
      throw new Error('שעת הסיום חייבת להיות מאוחרת משעת ההתחלה');
    }

    // Overlap check
    const overlap = db.reservations.find((r) => {
      if (r.status === 'rejected' || r.status === 'cancelled') return false;
      const rStart = new Date(r.start_time);
      const rEnd = new Date(r.end_time);
      return start < rEnd && end > rStart;
    });

    if (overlap) {
      const err = new Error(`הרכב תפוס בשעות אלו על ידי ${overlap.user_name}`);
      err.conflict = true;
      err.details = { conflictWith: overlap };
      throw err;
    }

    const durationHours = (end - start) / (1000 * 60 * 60);
    const needsApproval = durationHours > db.settings.approval_threshold_hours && user.role !== 'admin';

    const newRes = {
      id: `res-${Date.now()}`,
      user_id: user.id,
      user_name: user.name,
      user_color: user.color,
      start_time: data.start_time,
      end_time: data.end_time,
      reason: data.reason || 'נסיעה',
      destination: data.destination || '',
      location: db.settings.default_location,
      status: needsApproval ? 'pending_approval' : 'approved',
      created_at: new Date().toISOString()
    };

    db.reservations.push(newRes);
    saveDB(db);
    return newRes;
  },

  quickRide(minutes = 15, reason = 'קפיצה קצרה') {
    const now = new Date();
    const end = new Date(now.getTime() + minutes * 60000);
    const pad = (n) => String(n).padStart(2, '0');
    const startStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
    const endStr = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}:00`;

    return this.createReservation({
      start_time: startStr,
      end_time: endStr,
      reason: reason || 'קפיצה מהירה'
    });
  },

  returnCar(reservationId) {
    const db = loadDB();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:00`;

    let target = null;
    if (reservationId) {
      target = db.reservations.find((r) => r.id === reservationId);
    } else {
      target = db.reservations.find((r) => {
        if (r.status !== 'approved') return false;
        const s = new Date(r.start_time);
        const e = new Date(r.end_time);
        return now >= s && now <= e;
      });
    }

    if (target) {
      target.end_time = nowStr;
      saveDB(db);
      return { ok: true, reservation: target };
    }
    return { ok: true };
  },

  approveReservation(id) {
    const db = loadDB();
    const target = db.reservations.find((r) => r.id === id);
    if (!target) throw new Error('הזמנה לא נמצאה');
    target.status = 'approved';
    saveDB(db);
    return target;
  },

  rejectReservation(id, reason) {
    const db = loadDB();
    const target = db.reservations.find((r) => r.id === id);
    if (!target) throw new Error('הזמנה לא נמצאה');
    target.status = 'rejected';
    target.reject_reason = reason;
    saveDB(db);
    return target;
  },

  deleteReservation(id, reason) {
    const db = loadDB();
    const idx = db.reservations.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('הזמנה לא נמצאה');
    db.reservations.splice(idx, 1);
    saveDB(db);
    return { ok: true };
  },

  // Waitlist
  getWaitlist() {
    return loadDB().waitlist;
  },

  joinWaitlist(data) {
    const db = loadDB();
    const uid = localStorage.getItem('demo_current_user_id') || 'user-dad';
    const user = db.users.find((u) => u.id === uid) || db.users[0];

    const exists = db.waitlist.find(
      (w) => w.user_id === user.id && w.reservation_id === data.reservationId
    );
    if (exists) {
      return { alreadyWaiting: true };
    }

    const item = {
      id: `wait-${Date.now()}`,
      user_id: user.id,
      user_name: user.name,
      reservation_id: data.reservationId,
      target_start: data.targetStart,
      target_end: data.targetEnd,
      created_at: new Date().toISOString()
    };
    db.waitlist.push(item);
    saveDB(db);
    return { ok: true, item };
  },

  leaveWaitlist(id) {
    const db = loadDB();
    db.waitlist = db.waitlist.filter((w) => w.id !== id);
    saveDB(db);
    return { ok: true };
  },

  // Calendar
  getDayStatus(dateStr) {
    const d = new Date(dateStr);
    const dayOfWeek = d.getDay(); // 5 = Friday, 6 = Saturday
    const isFriday = dayOfWeek === 5;
    const isSaturday = dayOfWeek === 6;

    let notice = null;
    if (isFriday) {
      notice = 'יום שישי - כניסת שבת בערב';
    } else if (isSaturday) {
      notice = 'שבת קודש';
    }

    return {
      date: dateStr,
      isShabbatOrHoliday: isFriday || isSaturday,
      notice
    };
  },

  // Settings
  getSettings() {
    return loadDB().settings;
  },

  updateSettings(newSettings) {
    const db = loadDB();
    db.settings = { ...db.settings, ...newSettings };
    saveDB(db);
    return db.settings;
  },

  changePin(currentPin, newPin) {
    if (currentPin !== '1234') throw new Error('קוד PIN נוכחי שגוי');
    return { ok: true, message: 'קוד ה-PIN עודכן בהצלחה' };
  },

  // WhatsApp Simulator
  getWhatsAppStatus() {
    return {
      connected: false,
      hasSession: false,
      isReady: false,
      mode: 'simulation'
    };
  },

  connectWhatsApp() {
    return { ok: true, qr: 'DEMO_QR_CODE_READY_IN_SETTINGS' };
  },

  disconnectWhatsApp() {
    return { ok: true };
  },

  simulateWhatsAppMessage(text, asUserId) {
    const db = loadDB();
    const user = db.users.find((u) => u.id === asUserId) || db.users[0];
    const today = getTodayString();

    // Natural Hebrew parsing simulation
    const timeMatch = text.match(/(\d{1,2})[:.](\d{2})?\s*(?:עד|-|ל)\s*(\d{1,2})[:.](\d{2})?/);

    if (timeMatch) {
      const h1 = parseInt(timeMatch[1], 10);
      const m1 = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const h2 = parseInt(timeMatch[3], 10);
      const m2 = timeMatch[4] ? parseInt(timeMatch[4], 10) : 0;

      const pad = (n) => String(n).padStart(2, '0');
      const startStr = `${today}T${pad(h1)}:${pad(m1)}:00`;
      const endStr = `${today}T${pad(h2)}:${pad(m2)}:00`;

      try {
        const res = this.createReservation({
          start_time: startStr,
          end_time: endStr,
          reason: 'הוזמן דרך בוט הוואטסאפ (סימולציה)'
        });
        return {
          reply: `✅ היי ${user.name}, שריינתי לך את הרכב להיום מ-${pad(h1)}:${pad(m1)} עד ${pad(h2)}:${pad(m2)}! נסיעה טובה ובטוחה 🚗`
        };
      } catch (err) {
        if (err.conflict) {
          return {
            reply: `⚠️ לא הצלחתי לשריין. הרכב תפוס בשעות אלו על ידי ${err.details?.conflictWith?.user_name || 'אחד מבני המשפחה'}. רוצה להצטרף לרשימת ההמתנה?`
          };
        }
        return { reply: `❌ שגיאה: ${err.message}` };
      }
    }

    if (text.includes('מי לקח') || text.includes('מי ברכב') || text.includes('איפה הרכב')) {
      const status = this.getCarStatus();
      if (!status.isAvailable && status.currentDriver) {
        return {
          reply: `🚗 הרכב כרגע אצל ${status.currentDriver.name}. צפוי לחזור ב-${status.returnTime?.slice(11, 16) || 'בקרוב'}.`
        };
      }
      return {
        reply: `✅ הרכב פנוי כרגע ונמצא ב${db.settings.default_location}.`
      };
    }

    return {
      reply: `שלום ${user.name}! 🤖 קיבלתי את הודעתך: "${text}".\nכדי לשריין רכב, שלח לדוגמה: "אני צריך את הרכב היום מ-14:00 עד 16:00 לקניות".`
    };
  },

  sendTestDigest() {
    return {
      ok: true,
      message: 'התראת סיכום בוקר נשלחה בהצלחה לקבוצה'
    };
  }
};
