import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import {
  QrCode, Smartphone, Plus, Trash2, RefreshCw, Send, Lock, MessageSquare,
  Hourglass, Check, X, Pencil, KeyRound, Loader2, Car, Users, Bell, AlertCircle, Link2Off
} from 'lucide-react';
import Sheet from './Sheet';
import ConfirmDialog from './ConfirmDialog';
import { formatFullDate, formatTime, formatDuration } from '../utils/datetime';

const SECTIONS = [
  { id: 'pending', label: 'בקשות', Icon: Hourglass },
  { id: 'users', label: 'משפחה', Icon: Users },
  { id: 'car', label: 'רכב', Icon: Car },
  { id: 'bot', label: 'בוט', Icon: MessageSquare }
];

export default function AdminPanel() {
  const {
    currentUser, isAdminUnlocked, verifyAdminPin, users, loadUsers,
    refreshData, showToast, settings, loadSettings
  } = useApp();

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [section, setSection] = useState('pending');

  // ---- Pending approvals (this whole screen simply did not exist) ----
  const [pending, setPending] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [actingOn, setActingOn] = useState(null);

  // ---- WhatsApp ----
  const [waStatus, setWaStatus] = useState(null);
  const [waBusy, setWaBusy] = useState(false);
  const [simText, setSimText] = useState('רכב מחר מ-18:00 עד 20:00 לחוג');
  const [simAs, setSimAs] = useState('');
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState(null);

  // ---- Users ----
  const [userSheet, setUserSheet] = useState(null); // { mode: 'create'|'edit', user }
  const [userForm, setUserForm] = useState({ name: '', role: 'member', phone: '', color: '#0071E3', pin: '' });
  const [savingUser, setSavingUser] = useState(false);
  const [userError, setUserError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  // ---- Car settings ----
  const [form, setForm] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  // ---- PIN change ----
  const [pinSheetOpen, setPinSheetOpen] = useState(false);
  const [pinForm, setPinForm] = useState({ currentPin: '', newPin: '', confirmPin: '' });
  const [pinFormError, setPinFormError] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      setPending(await api.getPendingApprovals());
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setPendingLoading(false);
    }
  }, [showToast]);

  const loadWa = useCallback(async () => {
    try {
      setWaStatus(await api.getWhatsAppStatus());
    } catch {
      /* the card shows a disconnected state on its own */
    }
  }, []);

  useEffect(() => {
    if (!isAdminUnlocked) return;
    loadPending();
    loadWa();
    loadSettings();
  }, [isAdminUnlocked, loadPending, loadWa, loadSettings]);

  useEffect(() => {
    if (settings) setForm({ ...settings });
  }, [settings]);

  // While the QR is pending, poll so the code appears without a manual refresh.
  useEffect(() => {
    if (!isAdminUnlocked || section !== 'bot') return undefined;
    if (waStatus?.status !== 'initializing' && waStatus?.status !== 'waiting_for_qr') return undefined;
    const timer = setInterval(loadWa, 3000);
    return () => clearInterval(timer);
  }, [isAdminUnlocked, section, waStatus?.status, loadWa]);

  // ----------------------------------------------------
  // PIN gate
  // ----------------------------------------------------
  const handleUnlock = async (event) => {
    event.preventDefault();
    setPinError('');
    setVerifying(true);
    try {
      await verifyAdminPin(currentUser.id, pin.trim());
      showToast('פאנל הניהול נפתח 🔓', 'success');
      setPin('');
    } catch (err) {
      setPinError(err.message);
      setPin('');
    } finally {
      setVerifying(false);
    }
  };

  if (!isAdminUnlocked) {
    const isParent = currentUser?.role === 'admin';
    return (
      <div className="mb-safe-content pt-4">
        <div className="glass-card rounded-[1.75rem] p-7 max-w-sm mx-auto text-center">
          <div className="w-14 h-14 rounded-3xl bg-brand-600/12 text-brand-600 dark:text-brand-400
            flex items-center justify-center mx-auto mb-4">
            <Lock className="w-7 h-7" aria-hidden="true" />
          </div>

          <h2 className="text-[18px] font-bold text-slate-900 dark:text-white mb-1.5">
            אזור ניהול להורים
          </h2>

          {/* Explain rather than silently hide, when this is not your area. */}
          {!isParent ? (
            <p className="text-[14px] text-slate-500 dark:text-slate-400 leading-relaxed">
              רק אבא ואמא יכולים לאשר בקשות ארוכות, לנהל את רשימת המשפחה ולחבר
              את בוט הוואטסאפ.
              <br />
              <br />
              צריכים משהו? בקשו מהם להיכנס.
            </p>
          ) : (
            <form onSubmit={handleUnlock} className="space-y-4">
              <p className="text-[14px] text-slate-500 dark:text-slate-400">
                הזינו את קוד ה-PIN שלכם ({currentUser?.name})
              </p>

              <div>
                <label htmlFor="panel-pin" className="sr-only">קוד PIN</label>
                <input
                  id="panel-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  required
                  autoFocus
                  aria-invalid={!!pinError}
                  aria-describedby={pinError ? 'panel-pin-error' : undefined}
                  className="w-40 mx-auto block min-h-[52px] text-center text-[19px] font-bold
                    tracking-[0.3em] rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]
                    border border-black/10 dark:border-white/10 text-slate-900 dark:text-white
                    focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>

              {pinError && (
                <p id="panel-pin-error" role="alert" className="text-[13px] text-rose-600 dark:text-rose-400 font-semibold">
                  {pinError}
                </p>
              )}

              <button
                type="submit"
                disabled={verifying || pin.length < 4}
                className="w-full min-h-[48px] rounded-2xl bg-brand-600 hover:bg-brand-700 text-white
                  font-bold text-[15px] apple-btn-active disabled:opacity-50
                  inline-flex items-center justify-center gap-2"
              >
                {verifying && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                <span>{verifying ? 'מאמת...' : 'כניסה לפאנל'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // Handlers
  // ----------------------------------------------------
  const handleApprove = async (reservation) => {
    setActingOn(reservation.id);
    try {
      await api.approveReservation(reservation.id);
      showToast(`הבקשה של ${reservation.user?.name} אושרה ✅`, 'success');
      await Promise.all([loadPending(), refreshData({ quiet: true })]);
    } catch (err) {
      showToast(err.message, 'error');
      await loadPending();
    } finally {
      setActingOn(null);
    }
  };

  const handleReject = async (reservation) => {
    setActingOn(reservation.id);
    try {
      await api.rejectReservation(reservation.id);
      showToast(`הבקשה של ${reservation.user?.name} נדחתה`, 'info');
      await Promise.all([loadPending(), refreshData({ quiet: true })]);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setActingOn(null);
    }
  };

  const openUserSheet = (mode, user) => {
    setUserError('');
    setUserSheet({ mode, user });
    setUserForm(
      mode === 'edit'
        ? { name: user.name, role: user.role, phone: user.phone || '', color: user.color || '#0071E3', pin: '' }
        : { name: '', role: 'member', phone: '', color: '#34C759', pin: '' }
    );
  };

  const handleSaveUser = async (event) => {
    event.preventDefault();
    setUserError('');
    setSavingUser(true);
    try {
      const payload = {
        name: userForm.name.trim(),
        role: userForm.role,
        phone: userForm.phone.trim(),
        color: userForm.color,
        ...(userForm.pin ? { pin: userForm.pin } : {})
      };
      if (userSheet.mode === 'create') {
        await api.createUser(payload);
        showToast(`${payload.name} נוסף/ה למשפחה 🎉`, 'success');
      } else {
        await api.updateUser(userSheet.user.id, payload);
        showToast('הפרטים עודכנו', 'success');
      }
      await loadUsers();
      setUserSheet(null);
    } catch (err) {
      setUserError(err.message);
    } finally {
      setSavingUser(false);
    }
  };

  const handleDeleteUser = async () => {
    try {
      const result = await api.deleteUser(deleteTarget.id);
      showToast(
        result.cancelledReservations > 0
          ? `${result.name} הוסר/ה. ${result.cancelledReservations} שריונים בוטלו`
          : `${result.name} הוסר/ה מהמשפחה`,
        'info'
      );
      await Promise.all([loadUsers(), refreshData({ quiet: true })]);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleSaveSettings = async (event) => {
    event.preventDefault();
    setSettingsError('');
    setSavingSettings(true);
    try {
      await api.updateSettings(form);
      await loadSettings();
      showToast('ההגדרות נשמרו ✅', 'success');
    } catch (err) {
      // The old panel reported success unconditionally, so an invalid family
      // code looked as though it had been saved.
      setSettingsError(err.message);
      showToast(err.message, 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleChangePin = async (event) => {
    event.preventDefault();
    setPinFormError('');
    if (pinForm.newPin !== pinForm.confirmPin) {
      setPinFormError('שני הקודים החדשים אינם זהים');
      return;
    }
    if (!/^\d{4}$/.test(pinForm.newPin)) {
      setPinFormError('קוד PIN חייב להיות 4 ספרות');
      return;
    }
    setSavingPin(true);
    try {
      await api.changePin(pinForm.currentPin, pinForm.newPin);
      showToast('קוד ה-PIN עודכן 🔐', 'success');
      setPinSheetOpen(false);
      setPinForm({ currentPin: '', newPin: '', confirmPin: '' });
    } catch (err) {
      setPinFormError(err.message);
    } finally {
      setSavingPin(false);
    }
  };

  const handleSimulate = async (event) => {
    event.preventDefault();
    if (!simText.trim()) return;
    setSimulating(true);
    setSimResult(null);
    try {
      setSimResult(await api.simulateWhatsAppMessage(simText, simAs || currentUser.id));
      await refreshData({ quiet: true });
      await loadPending();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSimulating(false);
    }
  };

  const fieldClass =
    'w-full min-h-[46px] px-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] ' +
    'border border-black/10 dark:border-white/10 text-slate-900 dark:text-white ' +
    'text-[16px] focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent';
  const labelClass = 'block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5';
  const cardClass = 'glass-card rounded-[1.5rem] p-4';

  return (
    <div className="mb-safe-content">
      {/* Section switcher */}
      <div
        role="tablist"
        aria-label="אזורי ניהול"
        className="flex items-center gap-1 p-1 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] mb-4"
      >
        {SECTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
            className={`flex-1 min-h-[44px] px-2 rounded-xl text-[13px] font-bold apple-btn-active
              inline-flex items-center justify-center gap-1.5 ${
                section === id
                  ? 'bg-white dark:bg-ink-800 text-brand-600 dark:text-brand-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{label}</span>
            {id === 'pending' && pending.length > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white
                text-[10px] font-bold flex items-center justify-center">
                {pending.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ================= PENDING APPROVALS ================= */}
      {section === 'pending' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[15px] font-bold text-slate-900 dark:text-white">
              בקשות הממתינות לאישורכם
            </h2>
            <button
              type="button"
              onClick={loadPending}
              aria-label="רענון הבקשות"
              className="w-11 h-11 rounded-full flex items-center justify-center
                text-slate-500 hover:bg-black/5 dark:hover:bg-white/10 apple-btn-active"
            >
              <RefreshCw className={`w-4 h-4 ${pendingLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </div>

          {pendingLoading && pending.length === 0 && (
            <div className="space-y-2" aria-busy="true">
              {[0, 1].map((index) => (
                <div key={index} className="skeleton h-28 rounded-[1.5rem]" />
              ))}
            </div>
          )}

          {!pendingLoading && pending.length === 0 && (
            <div className={`${cardClass} text-center py-8`}>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400
                flex items-center justify-center mx-auto mb-3">
                <Check className="w-6 h-6" aria-hidden="true" />
              </div>
              <h3 className="text-[15px] font-bold text-slate-800 dark:text-slate-100">
                אין בקשות ממתינות
              </h3>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1 max-w-[18rem] mx-auto leading-relaxed">
                כל שריון מעל {settings?.approval_threshold_hours || 12} שעות יגיע לכאן, ותקבלו
                גם הודעה בוואטסאפ.
              </p>
            </div>
          )}

          {pending.map((reservation) => (
            <div
              key={reservation.id}
              className={cardClass}
              style={{ borderInlineStartWidth: '4px', borderInlineStartColor: reservation.user?.color }}
            >
              <div className="flex items-center gap-2.5 mb-2.5">
                <span
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-[13px]"
                  style={{ backgroundColor: reservation.user?.color }}
                  aria-hidden="true"
                >
                  {reservation.user?.name?.slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-slate-900 dark:text-white">
                    {reservation.user?.name}
                  </p>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 truncate">
                    {reservation.reason}
                  </p>
                </div>
                <span className="text-[12px] font-bold px-2 py-1 rounded-lg bg-amber-500/15
                  text-amber-700 dark:text-amber-400 shrink-0">
                  {formatDuration(reservation.start_time, reservation.end_time)}
                </span>
              </div>

              <p className="text-[13px] text-slate-600 dark:text-slate-300 mb-3 px-0.5">
                {formatFullDate(reservation.start_time)} ·{' '}
                <span className="tabular" dir="ltr">
                  {formatTime(reservation.start_time)}–{formatTime(reservation.end_time)}
                </span>
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleApprove(reservation)}
                  disabled={actingOn === reservation.id}
                  className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700
                    text-white font-bold text-[14px] apple-btn-active disabled:opacity-60
                    inline-flex items-center justify-center gap-1.5"
                >
                  {actingOn === reservation.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="w-4 h-4" aria-hidden="true" />
                  )}
                  אישור
                </button>
                <button
                  type="button"
                  onClick={() => handleReject(reservation)}
                  disabled={actingOn === reservation.id}
                  className="flex-1 min-h-[44px] rounded-xl bg-rose-500/12 text-rose-700 dark:text-rose-400
                    border border-rose-500/25 font-bold text-[14px] apple-btn-active disabled:opacity-60
                    inline-flex items-center justify-center gap-1.5"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                  דחייה
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ================= FAMILY ================= */}
      {section === 'users' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[15px] font-bold text-slate-900 dark:text-white">
              בני המשפחה ({users.length})
            </h2>
            <button
              type="button"
              onClick={() => openUserSheet('create')}
              className="min-h-[44px] px-3.5 rounded-xl bg-brand-600 text-white text-[13px] font-bold
                apple-btn-active inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              הוספה
            </button>
          </div>

          {users.map((user) => (
            <div key={user.id} className={`${cardClass} flex items-center gap-3`}>
              <span
                className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold text-[14px] shrink-0"
                style={{ backgroundColor: user.color }}
                aria-hidden="true"
              >
                {user.name.slice(0, 2)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[15px] font-bold text-slate-900 dark:text-white">
                    {user.name}
                  </span>
                  {user.role === 'admin' && (
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-brand-600/12
                      text-brand-700 dark:text-brand-300">
                      הורה
                    </span>
                  )}
                  {user.id === currentUser?.id && (
                    <span className="text-[11px] font-semibold text-slate-400">(את/ה)</span>
                  )}
                </div>
                <span className="text-[13px] text-slate-500 dark:text-slate-400 tabular" dir="ltr">
                  {user.phone || '—'}
                </span>
                {!user.phone && (
                  <span className="block text-[12px] text-amber-600 dark:text-amber-400">
                    בלי טלפון אין תזכורות אישיות
                  </span>
                )}
              </div>

              <div className="flex items-center gap-0.5 shrink-0">
                {/* Editing a member was impossible before - you could only add
                    and delete, so fixing a typo meant losing their history. */}
                <button
                  type="button"
                  onClick={() => openUserSheet('edit', user)}
                  aria-label={`עריכת ${user.name}`}
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-slate-500
                    hover:text-brand-600 hover:bg-brand-600/10 apple-btn-active"
                >
                  <Pencil className="w-4 h-4" aria-hidden="true" />
                </button>
                {user.id !== currentUser?.id && (
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(user)}
                    aria-label={`מחיקת ${user.name}`}
                    className="w-11 h-11 rounded-xl flex items-center justify-center text-slate-400
                      hover:text-rose-500 hover:bg-rose-500/10 apple-btn-active"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setPinSheetOpen(true)}
            className={`${cardClass} w-full flex items-center gap-3 text-start apple-btn-active`}
          >
            <span className="w-10 h-10 rounded-2xl bg-brand-600/12 text-brand-600 dark:text-brand-400
              flex items-center justify-center shrink-0">
              <KeyRound className="w-[18px] h-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-bold text-slate-900 dark:text-white">
                שינוי קוד ה-PIN שלי
              </span>
              <span className="block text-[13px] text-slate-500 dark:text-slate-400">
                קוד ההורה שמגן על אזור הניהול
              </span>
            </span>
          </button>
        </div>
      )}

      {/* ================= CAR ================= */}
      {section === 'car' && form && (
        <form onSubmit={handleSaveSettings} className={`${cardClass} space-y-4`}>
          <h2 className="text-[15px] font-bold text-slate-900 dark:text-white">הגדרות הרכב</h2>

          <div>
            <label htmlFor="set-code" className={labelClass}>קוד משפחתי</label>
            <input
              id="set-code"
              type="text"
              inputMode="numeric"
              value={form.family_code || ''}
              onChange={(event) =>
                setForm({ ...form, family_code: event.target.value.replace(/\D/g, '').slice(0, 12) })
              }
              className={fieldClass}
            />
            <p className="text-[12px] text-slate-400 mt-1">
              4–12 ספרות. שינוי הקוד יחייב את כל המשפחה להיכנס מחדש.
            </p>
          </div>

          <div>
            <label htmlFor="set-name" className={labelClass}>שם ודגם הרכב</label>
            <input
              id="set-name"
              type="text"
              value={form.car_name || ''}
              onChange={(event) => setForm({ ...form, car_name: event.target.value })}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="set-plate" className={labelClass}>מספר רישוי</label>
            <input
              id="set-plate"
              type="text"
              value={form.car_plate || ''}
              onChange={(event) => setForm({ ...form, car_plate: event.target.value })}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="set-location" className={labelClass}>מיקום החזרה קבוע</label>
            <input
              id="set-location"
              type="text"
              value={form.default_location || ''}
              onChange={(event) => setForm({ ...form, default_location: event.target.value })}
              className={fieldClass}
            />
            <p className="text-[12px] text-slate-400 mt-1">
              מופיע בתזכורת "נא להביא את הרכב ל..." לפני העברה לנהג הבא.
            </p>
          </div>

          <div>
            <label htmlFor="set-threshold" className={labelClass}>
              שריון ארוך מדורש אישור מעל
            </label>
            <div className="flex items-center gap-2">
              <input
                id="set-threshold"
                type="number"
                min={1}
                max={168}
                value={form.approval_threshold_hours ?? 12}
                onChange={(event) =>
                  setForm({ ...form, approval_threshold_hours: Number(event.target.value) })
                }
                className={`${fieldClass} w-24`}
              />
              <span className="text-[14px] text-slate-600 dark:text-slate-300">שעות</span>
            </div>
          </div>

          <div>
            <label htmlFor="set-group" className={labelClass}>
              מזהה קבוצת וואטסאפ <span className="text-slate-400 font-normal">(לא חובה)</span>
            </label>
            <input
              id="set-group"
              type="text"
              dir="ltr"
              placeholder="1203630...@g.us"
              value={form.whatsapp_group_id || ''}
              onChange={(event) => setForm({ ...form, whatsapp_group_id: event.target.value })}
              className={`${fieldClass} text-start`}
            />
            <p className="text-[12px] text-slate-400 mt-1">
              בלי זה ההודעות לקבוצה נרשמות ללוג השרת בלבד.
            </p>
          </div>

          {settingsError && (
            <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-400 font-semibold
              flex items-start gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
              {settingsError}
            </p>
          )}

          <button
            type="submit"
            disabled={savingSettings}
            className="w-full min-h-[48px] rounded-2xl bg-brand-600 hover:bg-brand-700 text-white
              font-bold text-[15px] apple-btn-active disabled:opacity-50
              inline-flex items-center justify-center gap-2"
          >
            {savingSettings && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            <span>{savingSettings ? 'שומר...' : 'שמירת שינויים'}</span>
          </button>
        </form>
      )}

      {/* ================= BOT ================= */}
      {section === 'bot' && (
        <div className="space-y-3">
          {/* Connection */}
          <div className={cardClass}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-10 h-10 rounded-2xl bg-emerald-500/12 text-emerald-600
                  dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Smartphone className="w-[18px] h-[18px]" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold text-slate-900 dark:text-white">
                    בוט וואטסאפ
                  </h2>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400">
                    שכבת ההתראות של האפליקציה
                  </p>
                </div>
              </div>

              <span
                className={`text-[12px] font-bold px-2.5 py-1 rounded-full border shrink-0 ${
                  waStatus?.status === 'connected'
                    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25'
                    : waStatus?.status === 'waiting_for_qr'
                    ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25'
                    : 'bg-slate-500/12 text-slate-600 dark:text-slate-400 border-slate-500/20'
                }`}
              >
                {waStatus?.status === 'connected'
                  ? 'מחובר'
                  : waStatus?.status === 'waiting_for_qr'
                  ? 'ממתין לסריקה'
                  : waStatus?.status === 'initializing'
                  ? 'מאתחל...'
                  : 'לא מחובר'}
              </span>
            </div>

            <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed
              bg-black/[0.04] dark:bg-white/[0.06] p-3 rounded-xl mb-3">
              {waStatus?.lastLog || 'התשתית מוכנה. אפשר להתחבר בכל עת.'}
            </p>

            {waStatus?.lastError && (
              <p className="text-[13px] text-rose-600 dark:text-rose-400 mb-3 flex items-start gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
                {waStatus.lastError}
              </p>
            )}

            {waStatus?.qrDataUrl && (
              <div className="p-4 bg-white rounded-2xl text-center mb-3 border border-black/10">
                <p className="text-[13px] font-bold text-slate-900 mb-2">
                  סרקו מהוואטסאפ בטלפון
                </p>
                <img src={waStatus.qrDataUrl} alt="קוד QR לחיבור וואטסאפ" className="w-44 h-44 mx-auto" />
                <p className="text-[12px] text-slate-500 mt-2">
                  הגדרות ← מכשירים מקושרים ← קישור מכשיר
                </p>
              </div>
            )}

            <div className="flex items-center gap-2">
              {waStatus?.status !== 'connected' ? (
                <button
                  type="button"
                  onClick={async () => {
                    setWaBusy(true);
                    try {
                      const result = await api.connectWhatsApp();
                      if (result.success === false) showToast(result.error, 'error');
                      setTimeout(loadWa, 1500);
                    } catch (err) {
                      showToast(err.message, 'error');
                    } finally {
                      setWaBusy(false);
                    }
                  }}
                  disabled={waBusy}
                  className="flex-1 min-h-[48px] rounded-2xl bg-emerald-600 hover:bg-emerald-700
                    text-white font-bold text-[14px] apple-btn-active disabled:opacity-60
                    inline-flex items-center justify-center gap-2"
                >
                  {waBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <QrCode className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>{waBusy ? 'מאתחל...' : 'חיבור וקוד QR'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    setWaBusy(true);
                    try {
                      await api.disconnectWhatsApp();
                      showToast('וואטסאפ נותק', 'info');
                      await loadWa();
                    } catch (err) {
                      showToast(err.message, 'error');
                    } finally {
                      setWaBusy(false);
                    }
                  }}
                  disabled={waBusy}
                  className="flex-1 min-h-[48px] rounded-2xl bg-rose-500/12 text-rose-600 dark:text-rose-400
                    border border-rose-500/25 font-bold text-[14px] apple-btn-active
                    inline-flex items-center justify-center gap-1.5"
                >
                  <Link2Off className="w-4 h-4" aria-hidden="true" />
                  ניתוק
                </button>
              )}

              <button
                type="button"
                onClick={loadWa}
                aria-label="רענון מצב החיבור"
                className="w-11 h-11 rounded-2xl flex items-center justify-center bg-black/5
                  dark:bg-white/10 text-slate-700 dark:text-slate-300 apple-btn-active shrink-0"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <button
              type="button"
              onClick={async () => {
                try {
                  await api.sendTestDigest();
                  showToast('סיכום היום נשלח (או נרשם בלוג אם אין חיבור)', 'success');
                } catch (err) {
                  showToast(err.message, 'error');
                }
              }}
              className="w-full min-h-[44px] mt-2 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]
                text-slate-700 dark:text-slate-200 font-semibold text-[13px] apple-btn-active
                inline-flex items-center justify-center gap-1.5"
            >
              <Bell className="w-4 h-4" aria-hidden="true" />
              שליחת סיכום יומי לבדיקה
            </button>
          </div>

          {/* Simulator */}
          <div className={cardClass}>
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-9 h-9 rounded-2xl bg-brand-600/12 text-brand-600 dark:text-brand-400
                flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold text-slate-900 dark:text-white">
                  סימולטור הבוט
                </h2>
                <p className="text-[12px] text-slate-500 dark:text-slate-400">
                  בדיקת פענוח השפה בלי טלפון מחובר
                </p>
              </div>
            </div>

            <form onSubmit={handleSimulate} className="space-y-3">
              {/* The sender picker existed as state with no control at all, so
                  every simulated message was attributed to a hardcoded name. */}
              <div>
                <label htmlFor="sim-as" className={labelClass}>שולח/ת ההודעה</label>
                <select
                  id="sim-as"
                  value={simAs || currentUser.id}
                  onChange={(event) => setSimAs(event.target.value)}
                  className={fieldClass}
                >
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="sim-text" className={labelClass}>
                  ההודעה (חייבת להתחיל ב"רכב")
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="sim-text"
                    type="text"
                    value={simText}
                    onChange={(event) => setSimText(event.target.value)}
                    className={fieldClass}
                  />
                  <button
                    type="submit"
                    disabled={simulating}
                    aria-label="שליחת ההודעה לסימולטור"
                    className="w-12 h-12 shrink-0 rounded-xl bg-brand-600 hover:bg-brand-700 text-white
                      flex items-center justify-center apple-btn-active disabled:opacity-60"
                  >
                    {simulating ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {[
                  'רכב מחר מ-16:00 עד 19:00 לחוג',
                  'רכב ב-8 בערב להופעה',
                  'רכב מי לוקח היום?',
                  'רכב קפיצה של 10 דקות למכולת',
                  'רכב מ-23:00 עד 01:00 לנתב"ג',
                  'רכב המתן',
                  'רכב בטל'
                ].map((idea) => (
                  <button
                    type="button"
                    key={idea}
                    onClick={() => setSimText(idea)}
                    className="min-h-[44px] px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06]
                      text-slate-600 dark:text-slate-300 text-[12px] apple-btn-active"
                  >
                    {idea}
                  </button>
                ))}
              </div>
            </form>

            {simResult && (
              <div className="mt-3.5 p-3.5 rounded-2xl bg-slate-900 dark:bg-black/60 border border-slate-700">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-700">
                  <span className="text-[13px] font-bold text-emerald-400">תשובת הבוט</span>
                  <span className="text-[11px] text-slate-400">
                    {simResult.parsed?.action || 'ignored'}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-100">
                  {simResult.reply}
                </p>
                {simResult.parsed && (
                  <details className="mt-2.5">
                    <summary className="text-[12px] text-slate-400 cursor-pointer hover:text-slate-200">
                      ה-JSON המפוענח
                    </summary>
                    <pre
                      dir="ltr"
                      className="mt-2 p-2 rounded-lg bg-black/60 overflow-x-auto text-[11px] text-emerald-300"
                    >
                      {JSON.stringify(simResult.parsed, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- User sheet ---------------- */}
      <Sheet
        isOpen={!!userSheet}
        onClose={() => setUserSheet(null)}
        title={userSheet?.mode === 'edit' ? `עריכת ${userSheet.user.name}` : 'הוספת בן/בת משפחה'}
        maxWidth="max-w-sm"
        footer={
          <button
            type="submit"
            form="user-form"
            disabled={savingUser || !userForm.name.trim()}
            className="w-full min-h-[48px] rounded-2xl bg-brand-600 hover:bg-brand-700 text-white
              font-bold text-[15px] apple-btn-active disabled:opacity-50
              inline-flex items-center justify-center gap-2"
          >
            {savingUser && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            <span>{savingUser ? 'שומר...' : 'שמירה'}</span>
          </button>
        }
      >
        <form id="user-form" onSubmit={handleSaveUser} className="space-y-3.5">
          <div>
            <label htmlFor="uf-name" className={labelClass}>שם</label>
            <input
              id="uf-name"
              type="text"
              value={userForm.name}
              onChange={(event) => setUserForm({ ...userForm, name: event.target.value })}
              required
              maxLength={40}
              data-autofocus
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="uf-phone" className={labelClass}>טלפון (בינלאומי)</label>
            <input
              id="uf-phone"
              type="tel"
              dir="ltr"
              autoComplete="tel"
              placeholder="972501234567"
              value={userForm.phone}
              onChange={(event) => setUserForm({ ...userForm, phone: event.target.value })}
              className={`${fieldClass} text-start`}
            />
            <p className="text-[12px] text-slate-400 mt-1">
              נדרש לתזכורות אישיות ולזיהוי בקבוצת הוואטסאפ.
            </p>
          </div>

          <div>
            <label htmlFor="uf-role" className={labelClass}>תפקיד</label>
            <select
              id="uf-role"
              value={userForm.role}
              onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}
              className={fieldClass}
            >
              <option value="member">בן/בת משפחה</option>
              <option value="admin">הורה (מנהל)</option>
            </select>
          </div>

          {userForm.role === 'admin' && (
            <div>
              <label htmlFor="uf-pin" className={labelClass}>
                קוד PIN {userSheet?.mode === 'edit' ? '(השאירו ריק כדי לא לשנות)' : ''}
              </label>
              <input
                id="uf-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                value={userForm.pin}
                onChange={(event) =>
                  setUserForm({ ...userForm, pin: event.target.value.replace(/\D/g, '').slice(0, 4) })
                }
                className={fieldClass}
              />
            </div>
          )}

          <div>
            <span className={labelClass}>צבע מזהה בלוח הזמנים</span>
            <div className="flex items-center gap-2 flex-wrap">
              {['#0071E3', '#AF52DE', '#34C759', '#FF9500', '#FF2D55', '#5AC8FA', '#FFCC00', '#8E8E93'].map(
                (color) => (
                  <button
                    type="button"
                    key={color}
                    onClick={() => setUserForm({ ...userForm, color })}
                    aria-label={`בחירת הצבע ${color}`}
                    aria-pressed={userForm.color === color}
                    className={`w-11 h-11 rounded-2xl apple-btn-active transition-all ${
                      userForm.color === color
                        ? 'ring-2 ring-offset-2 ring-brand-600 ring-offset-white dark:ring-offset-ink-850 scale-105'
                        : ''
                    }`}
                    style={{ backgroundColor: color }}
                  >
                    {userForm.color === color && (
                      <Check className="w-4 h-4 text-white mx-auto" aria-hidden="true" />
                    )}
                  </button>
                )
              )}
            </div>
          </div>

          {userError && (
            <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-400 font-semibold">
              {userError}
            </p>
          )}
        </form>
      </Sheet>

      {/* ---------------- PIN change sheet ---------------- */}
      <Sheet
        isOpen={pinSheetOpen}
        onClose={() => setPinSheetOpen(false)}
        title="שינוי קוד PIN"
        icon={KeyRound}
        maxWidth="max-w-sm"
        footer={
          <button
            type="submit"
            form="pin-form"
            disabled={savingPin}
            className="w-full min-h-[48px] rounded-2xl bg-brand-600 hover:bg-brand-700 text-white
              font-bold text-[15px] apple-btn-active disabled:opacity-50"
          >
            {savingPin ? 'שומר...' : 'עדכון הקוד'}
          </button>
        }
      >
        <form id="pin-form" onSubmit={handleChangePin} className="space-y-3.5">
          {[
            { id: 'cur', label: 'הקוד הנוכחי', key: 'currentPin' },
            { id: 'new', label: 'קוד חדש', key: 'newPin' },
            { id: 'cnf', label: 'אימות הקוד החדש', key: 'confirmPin' }
          ].map((field) => (
            <div key={field.id}>
              <label htmlFor={`pin-${field.id}`} className={labelClass}>
                {field.label}
              </label>
              <input
                id={`pin-${field.id}`}
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                value={pinForm[field.key]}
                onChange={(event) =>
                  setPinForm({ ...pinForm, [field.key]: event.target.value.replace(/\D/g, '').slice(0, 4) })
                }
                required
                {...(field.id === 'cur' ? { 'data-autofocus': true } : {})}
                className={fieldClass}
              />
            </div>
          ))}

          {pinFormError && (
            <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-400 font-semibold">
              {pinFormError}
            </p>
          )}
        </form>
      </Sheet>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteUser}
        title={`למחוק את ${deleteTarget?.name}?`}
        message="השריונים העתידיים שלהם יבוטלו והמשפחה תקבל הודעה. אי אפשר לבטל את הפעולה."
        confirmLabel="כן, מחקו"
      />
    </div>
  );
}
