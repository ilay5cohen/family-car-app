import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import {
  Car, Clock, CalendarDays, MapPin, Trash2, Check, X, Hourglass,
  BellRing, Bell, Loader2, Phone, StickyNote
} from 'lucide-react';
import Sheet from './Sheet';
import ConfirmDialog from './ConfirmDialog';
import { formatTime, formatFullDate, formatDuration, spansMidnight } from '../utils/datetime';

export default function ReservationDetailsModal({ reservation, onClose }) {
  const { currentUser, isAdminUnlocked, refreshData, showToast, myWaitlist } = useApp();
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // 'cancel' | 'reject'

  if (!reservation) return null;

  const isOwner = currentUser?.id === reservation.user_id;
  /**
   * Admin powers require the PIN to have actually been entered on this device.
   * The old check was `currentUser?.role === 'admin'`, which - combined with the
   * "continue without a PIN" button on the login screen - handed override
   * powers to anyone who tapped אבא.
   */
  const canOverride = isAdminUnlocked;
  const canCancel = isOwner || canOverride;

  const isPending = reservation.status === 'pending_approval';
  const isDone = reservation.status === 'completed';
  const isCancelled = reservation.status === 'cancelled';
  const isFuture = new Date(reservation.start_time) > new Date();
  const isActive = !isDone && !isCancelled && !isFuture && new Date(reservation.end_time) > new Date();
  const crossesMidnight = spansMidnight(reservation.start_time, reservation.end_time);

  const isWaitlisted = myWaitlist.some(
    (w) => w.target_start === reservation.start_time && w.target_end === reservation.end_time
  );

  const run = async (label, fn) => {
    setBusy(true);
    try {
      const result = await fn();
      showToast(label(result), 'success');
      await refreshData();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  };

  const handleCancel = () =>
    run(
      (result) =>
        result?.waitlistNotified > 0
          ? `השריון בוטל. הודענו ל${result.waitlistNames.join(', ')} 🔔`
          : 'השריון בוטל',
      () => api.deleteReservation(reservation.id)
    );

  const handleApprove = () =>
    run(() => 'הבקשה אושרה ✅', () => api.approveReservation(reservation.id));

  const handleReject = () =>
    run(() => 'הבקשה נדחתה', () => api.rejectReservation(reservation.id));

  const handleReturn = () =>
    run(
      (result) =>
        result?.waitlistNotified > 0
          ? `תודה! הודענו ל${result.waitlistNames.join(', ')} שהרכב פנוי 🔔`
          : 'תודה שהחזרת את הרכב! 🌟',
      () => api.returnCar(reservation.id)
    );

  const handleWaitlist = async () => {
    setBusy(true);
    try {
      await api.joinWaitlist({
        reservationId: reservation.id,
        targetStart: reservation.start_time,
        targetEnd: reservation.end_time
      });
      showToast('נרשמת לרשימת ההמתנה. נודיע לך בוואטסאפ 🔔', 'success');
      await refreshData({ quiet: true });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const color = reservation.user?.color || '#0071E3';

  const statusChip = isCancelled
    ? { text: 'בוטל', className: 'bg-slate-500/15 text-slate-600 dark:text-slate-400', Icon: X }
    : isDone
    ? { text: 'הוחזר', className: 'bg-slate-500/15 text-slate-600 dark:text-slate-400', Icon: Check }
    : isPending
    ? { text: 'ממתין לאישור הורה', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', Icon: Hourglass }
    : isActive
    ? { text: 'בנסיעה עכשיו', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', Icon: Car }
    : { text: 'מאושר', className: 'bg-brand-600/15 text-brand-700 dark:text-brand-300', Icon: Check };

  return (
    <>
      <Sheet
        isOpen={!!reservation}
        onClose={onClose}
        title={reservation.user?.name}
        subtitle={reservation.reason}
        icon={Car}
        accentColor={color}
        maxWidth="max-w-md"
        footer={
          <div className="flex flex-col gap-2">
            {isActive && (isOwner || canOverride) && (
              <button
                type="button"
                onClick={handleReturn}
                disabled={busy}
                className="w-full min-h-[48px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white
                  font-bold text-[15px] apple-btn-active shadow-lg shadow-emerald-600/25
                  disabled:opacity-60 inline-flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
                <span>{isOwner ? 'החזרתי את הרכב' : 'סמנו כהוחזר'}</span>
              </button>
            )}

            {!isDone && !isCancelled && canCancel && (
              <button
                type="button"
                onClick={() => setConfirmAction('cancel')}
                disabled={busy}
                className="w-full min-h-[44px] rounded-2xl bg-rose-500/10 hover:bg-rose-500/20
                  text-rose-600 dark:text-rose-400 font-bold text-[14px] border border-rose-500/25
                  apple-btn-active disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                <span>{isOwner ? 'ביטול השריון שלי' : 'ביטול השריון (הורה)'}</span>
              </button>
            )}

            {!isOwner && !isDone && !isCancelled && (isActive || isFuture) && (
              <button
                type="button"
                onClick={handleWaitlist}
                disabled={busy || isWaitlisted}
                className={`w-full min-h-[44px] rounded-2xl font-bold text-[14px] apple-btn-active
                  inline-flex items-center justify-center gap-1.5 border disabled:opacity-100 ${
                    isWaitlisted
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25'
                      : 'bg-brand-600/10 text-brand-700 dark:text-brand-300 border-brand-600/25 hover:bg-brand-600/20'
                  }`}
              >
                {isWaitlisted ? <Bell className="w-4 h-4" aria-hidden="true" /> : <BellRing className="w-4 h-4" aria-hidden="true" />}
                <span>{isWaitlisted ? 'ברשימת ההמתנה' : 'הודיעו לי אם יתפנה'}</span>
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-3.5">
          {/* Status */}
          <div className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl ${statusChip.className}`}>
            <statusChip.Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="text-[14px] font-bold">{statusChip.text}</span>
          </div>

          {/* When */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]">
              <span className="flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400 mb-1">
                <CalendarDays className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                תאריך
              </span>
              <span className="block text-[14px] font-bold text-slate-800 dark:text-slate-100">
                {formatFullDate(reservation.start_time)}
              </span>
              {crossesMidnight && (
                <span className="block text-[12px] text-indigo-600 dark:text-indigo-400 mt-0.5 font-semibold">
                  עד {formatFullDate(reservation.end_time)}
                </span>
              )}
            </div>

            <div className="p-3 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]">
              <span className="flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400 mb-1">
                <Clock className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                שעות
              </span>
              <time
                dir="ltr"
                dateTime={reservation.start_time}
                className="block text-[14px] font-bold text-slate-800 dark:text-slate-100 tabular"
              >
                {formatTime(reservation.start_time)}–{formatTime(reservation.end_time)}
              </time>
              <span className="block text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
                {formatDuration(reservation.start_time, reservation.end_time)}
              </span>
            </div>
          </div>

          {/* Purpose */}
          <div className="p-3.5 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]">
            <span className="flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400 mb-1">
              <MapPin className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
              יעד ומטרה
            </span>
            <p className="text-[15px] font-medium text-slate-800 dark:text-slate-100 break-words">
              {reservation.reason}
            </p>
          </div>

          {reservation.notes && (
            <div className="p-3.5 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]">
              <span className="flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400 mb-1">
                <StickyNote className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                הערות
              </span>
              <p className="text-[14px] text-slate-700 dark:text-slate-200 break-words leading-relaxed">
                {reservation.notes}
              </p>
            </div>
          )}

          {/* Driver - phone only reaches an unlocked parent */}
          {canOverride && reservation.user?.phone && (
            <a
              href={`tel:${reservation.user.phone}`}
              className="flex items-center gap-2.5 p-3 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]
                min-h-[44px] apple-btn-active"
            >
              <Phone className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" aria-hidden="true" />
              <span className="text-[14px] font-semibold text-slate-800 dark:text-slate-100" dir="ltr">
                {reservation.user.phone}
              </span>
            </a>
          )}

          {reservation.cancel_reason && (
            <p className="text-[13px] text-slate-500 dark:text-slate-400 px-1 leading-relaxed">
              סיבת הביטול: {reservation.cancel_reason}
            </p>
          )}

          {reservation.approved_by && (
            <p className="text-[13px] text-slate-500 dark:text-slate-400 px-1">
              אושר על ידי {reservation.approved_by}
            </p>
          )}

          {/* Parent approval controls */}
          {isPending && canOverride && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 space-y-2.5">
              <p className="text-[13px] font-bold text-amber-800 dark:text-amber-300">
                בקשה של {formatDuration(reservation.start_time, reservation.end_time)} ממתינה
                להחלטה שלכם
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={busy}
                  className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white
                    font-bold text-[14px] apple-btn-active disabled:opacity-60
                    inline-flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" aria-hidden="true" />
                  אישור
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAction('reject')}
                  disabled={busy}
                  className="flex-1 min-h-[44px] rounded-xl bg-rose-500/12 text-rose-700 dark:text-rose-400
                    border border-rose-500/25 font-bold text-[14px] apple-btn-active disabled:opacity-60
                    inline-flex items-center justify-center gap-1.5"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                  דחייה
                </button>
              </div>
            </div>
          )}

          {isPending && !canOverride && (
            <p className="text-[13px] text-slate-500 dark:text-slate-400 px-1 leading-relaxed">
              {isOwner
                ? 'הבקשה שלך נשלחה לאבא/אמא בוואטסאפ. תקבל/י הודעה כשיחליטו.'
                : 'רק הורה עם קוד PIN יכול לאשר או לדחות בקשה ארוכה.'}
            </p>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        isOpen={confirmAction === 'cancel'}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleCancel}
        loading={busy}
        title="לבטל את השריון?"
        message={
          isOwner
            ? `${formatFullDate(reservation.start_time)}, ${formatTime(reservation.start_time)}–${formatTime(reservation.end_time)}. מי שממתין לזמן הזה יקבל הודעה.`
            : `אתם מבטלים את השריון של ${reservation.user?.name}. הוא/היא יקבלו הודעה בוואטסאפ.`
        }
        confirmLabel="כן, בטלו"
        cancelLabel="לא, השארו"
      />

      <ConfirmDialog
        isOpen={confirmAction === 'reject'}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleReject}
        loading={busy}
        title="לדחות את הבקשה?"
        message={`${reservation.user?.name} יקבל/תקבל הודעה בוואטסאפ שהבקשה נדחתה.`}
        confirmLabel="דחו את הבקשה"
        cancelLabel="חזרה"
      />
    </>
  );
}
