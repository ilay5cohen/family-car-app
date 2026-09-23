import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { CalendarPlus, AlertCircle, BellRing, Check, Moon, Loader2, Hourglass, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';
import Sheet from './Sheet';
import {
  todayKey, combineDateTime, toTimeInput, nextQuarterHour, addMinutesToTime,
  formatDuration, formatTime, formatFullDate
} from '../utils/datetime';

const APPROVAL_HOURS = 12;

/**
 * Computes the opening state once, at mount.
 * App.jsx mounts this component only while the sheet is open, so every opening
 * starts from a clean, correctly-seeded form - the old version stayed mounted
 * for the whole session, which froze the date on the day the app was loaded and
 * left the previous booking's reason and notes in the fields.
 */
function initialWindow(selectedDate, prefill) {
  const openingToday = selectedDate === todayKey();
  let start;
  if (prefill?.hour !== undefined) {
    start = combineDateTime(selectedDate, `${String(prefill.hour).padStart(2, '0')}:00`);
  } else if (openingToday) {
    // The next quarter hour, not a hardcoded 16:00 that sat in the past for
    // most of the day.
    start = nextQuarterHour();
  } else {
    start = combineDateTime(selectedDate, '09:00');
  }
  const startStr = toTimeInput(start);
  const { time: endStr, dayOffset } = addMinutesToTime(startStr, 120);
  return { startStr, endStr, endsNextDay: dayOffset > 0 };
}

export default function ReservationModal({ onClose, prefill }) {
  const {
    currentUser, selectedDate, refreshData, showToast, settings, dayInfo, isAdminUnlocked, users
  } = useApp();

  const seed = useMemo(() => initialWindow(selectedDate, prefill), [selectedDate, prefill]);

  const [date, setDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState(seed.startStr);
  const [endTime, setEndTime] = useState(seed.endStr);
  // Lets the form express 23:00 -> 01:00, which was simply impossible before:
  // one date field plus two times meant any end time before the start was
  // rejected as "end must be after start".
  const [endsNextDay, setEndsNextDay] = useState(seed.endsNextDay);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [bookFor, setBookFor] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [waitlistJoined, setWaitlistJoined] = useState(false);
  const [shabbatAcknowledged, setShabbatAcknowledged] = useState(false);

  const { startFull, endFull, durationMinutes, isValid } = useMemo(() => {
    const s = combineDateTime(date, startTime);
    const e = combineDateTime(date, endTime, endsNextDay ? 1 : 0);
    const minutes = (e - s) / 60000;
    return { startFull: s, endFull: e, durationMinutes: minutes, isValid: minutes > 0 };
  }, [date, startTime, endTime, endsNextDay]);

  const threshold = Number(settings?.approval_threshold_hours) || APPROVAL_HOURS;
  const needsApproval = isValid && durationMinutes / 60 > threshold && currentUser?.role !== 'admin';
  const startsInPast = startFull.getTime() < Date.now() - 60000;

  // Does this window fall inside Shabbat / chag hours?
  const hitsRestricted = useMemo(() => {
    if (!dayInfo?.restrictedFrom || !dayInfo?.restrictedUntil || !isValid) return false;
    const from = new Date(dayInfo.restrictedFrom).getTime();
    const until = new Date(dayInfo.restrictedUntil).getTime();
    return startFull.getTime() < until && endFull.getTime() > from;
  }, [dayInfo, startFull, endFull, isValid]);

  /** Quick duration chips. These now roll over midnight correctly - the old
   *  version used getHours(), so +3h from 23:00 produced 02:00 on the SAME day
   *  and the form rejected its own suggestion. */
  const applyDuration = (minutes) => {
    const { time, dayOffset } = addMinutesToTime(startTime, minutes);
    setEndTime(time);
    setEndsNextDay(dayOffset > 0);
  };

  const handleStartChange = (value) => {
    setStartTime(value);
    // Keep the duration stable when the start moves.
    if (isValid) {
      const { time, dayOffset } = addMinutesToTime(value, durationMinutes);
      setEndTime(time);
      setEndsNextDay(dayOffset > 0);
    }
  };

  const handleEndChange = (value) => {
    setEndTime(value);
    // An end earlier than the start almost always means "after midnight".
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = value.split(':').map(Number);
    setEndsNextDay(eh * 60 + em <= sh * 60 + sm);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setConflict(null);

    if (!isValid) {
      setError('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
      return;
    }
    if (hitsRestricted && !shabbatAcknowledged) {
      setError('השריון חופף לשבת/חג. סמנו את האישור למטה אם זה מקרה חירום');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.createReservation({
        startTime: startFull.toISOString(),
        endTime: endFull.toISOString(),
        reason: reason.trim() || 'נסיעה כללית',
        notes: notes.trim(),
        ...(bookFor && bookFor !== currentUser.id ? { userId: bookFor } : {})
      });

      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        confetti({ particleCount: 55, spread: 75, origin: { y: 0.7 }, disableForReducedMotion: true });
      }

      showToast(
        result.requiresApproval
          ? 'הבקשה נשלחה לאבא/אמא לאישור ⏳'
          : 'הרכב שוריין בהצלחה! 🚗',
        result.requiresApproval ? 'info' : 'success'
      );

      await refreshData();
      onClose();
    } catch (err) {
      // Only a genuine scheduling clash offers the waitlist. A validation error
      // used to trigger the same "shall we tell you when it frees up?" prompt.
      if (err.conflict && err.details?.conflictingReservation) {
        setConflict(err.details);
      }
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinWaitlist = async () => {
    try {
      await api.joinWaitlist({
        reservationId: conflict?.conflictingReservation?.id,
        targetStart: startFull.toISOString(),
        targetEnd: endFull.toISOString()
      });
      setWaitlistJoined(true);
      await refreshData({ quiet: true });
      showToast('נרשמת לרשימת ההמתנה. נודיע לך בוואטסאפ 🔔', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const fieldClass =
    'w-full min-h-[48px] px-4 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] ' +
    'border border-black/10 dark:border-white/10 text-slate-900 dark:text-white ' +
    'text-[16px] focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent';

  const labelClass = 'block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5';

  return (
    <Sheet
      isOpen
      onClose={onClose}
      title="שריון רכב"
      subtitle={isValid ? `${formatFullDate(startFull)} · ${formatDuration(startFull, endFull)}` : undefined}
      icon={CalendarPlus}
      footer={
        <button
          type="submit"
          form="reservation-form"
          disabled={submitting || !isValid}
          className="w-full min-h-[50px] rounded-2xl bg-brand-600 hover:bg-brand-700 text-white
            font-bold text-[16px] shadow-lg shadow-brand-600/25 apple-btn-active
            disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          <span>
            {submitting ? 'בודקים זמינות...' : needsApproval ? 'שליחת בקשה לאישור' : 'שריון הרכב'}
          </span>
        </button>
      }
    >
      <form id="reservation-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Who */}
        <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]">
          <span className="text-[13px] text-slate-500 dark:text-slate-400">הנהג/ת</span>
          {isAdminUnlocked ? (
            <select
              value={bookFor || currentUser?.id || ''}
              onChange={(event) => setBookFor(event.target.value)}
              aria-label="שריון עבור"
              className="min-h-[44px] px-2.5 rounded-xl bg-white dark:bg-ink-800 border border-black/10
                dark:border-white/10 text-[15px] font-bold text-slate-900 dark:text-white
                focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                  {user.id === currentUser?.id ? ' (את/ה)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <span className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: currentUser?.color || '#0071E3' }}
                aria-hidden="true"
              />
              <span className="text-[15px] font-bold text-slate-900 dark:text-white">
                {currentUser?.name}
              </span>
            </span>
          )}
        </div>

        {/* When */}
        <div>
          <label htmlFor="res-date" className={labelClass}>תאריך</label>
          <input
            id="res-date"
            type="date"
            value={date}
            min={todayKey()}
            onChange={(event) => setDate(event.target.value)}
            required
            className={fieldClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="res-start" className={labelClass}>משעה</label>
            <input
              id="res-start"
              type="time"
              value={startTime}
              onChange={(event) => handleStartChange(event.target.value)}
              required
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="res-end" className={labelClass}>עד שעה</label>
            <input
              id="res-end"
              type="time"
              value={endTime}
              onChange={(event) => handleEndChange(event.target.value)}
              required
              aria-describedby={endsNextDay ? 'next-day-hint' : undefined}
              className={fieldClass}
            />
          </div>
        </div>

        {/* Cross-midnight control */}
        <label
          className={`flex items-center justify-between gap-3 p-3 rounded-2xl cursor-pointer
            transition-colors ${
              endsNextDay
                ? 'bg-indigo-500/10 border border-indigo-500/25'
                : 'bg-black/[0.03] dark:bg-white/[0.04] border border-transparent'
            }`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <Moon
              className={`w-4 h-4 shrink-0 ${endsNextDay ? 'text-indigo-500' : 'text-slate-400'}`}
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold text-slate-800 dark:text-slate-100">
                מסתיים למחרת
              </span>
              <span id="next-day-hint" className="block text-[12px] text-slate-500 dark:text-slate-400">
                לנסיעות שחוצות חצות (למשל 23:00 עד 01:00)
              </span>
            </span>
          </span>
          <input
            type="checkbox"
            checked={endsNextDay}
            onChange={(event) => setEndsNextDay(event.target.checked)}
            className="w-11 h-6 shrink-0 appearance-none rounded-full bg-slate-300 dark:bg-neutral-600
              checked:bg-indigo-500 relative cursor-pointer transition-colors
              before:content-[''] before:absolute before:top-0.5 before:w-5 before:h-5
              before:rounded-full before:bg-white before:shadow before:transition-all
              before:right-0.5 checked:before:right-[1.375rem]"
          />
        </label>

        {/* Duration chips */}
        <div>
          <span className="block text-[12px] text-slate-400 dark:text-slate-500 mb-1.5">משך מהיר</span>
          <div className="grid grid-cols-5 gap-1.5">
          {[
            { label: '30 דק׳', minutes: 30 },
            { label: 'שעה', minutes: 60 },
            { label: 'שעתיים', minutes: 120 },
            { label: '4 שעות', minutes: 240 },
            { label: 'יום', minutes: 600 }
          ].map((option) => (
            <button
              type="button"
              key={option.minutes}
              onClick={() => applyDuration(option.minutes)}
              aria-pressed={durationMinutes === option.minutes}
              className={`min-h-[44px] px-1 rounded-xl text-[12px] font-semibold apple-btn-active ${
                durationMinutes === option.minutes
                  ? 'bg-brand-600 text-white'
                  : 'bg-black/5 dark:bg-white/10 text-slate-700 dark:text-slate-300'
              }`}
            >
              {option.label}
            </button>
          ))}
          </div>
        </div>

        {/* Inline validation, right where the problem is */}
        {!isValid && (
          <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-400 font-semibold">
            שעת הסיום חייבת להיות אחרי ההתחלה. אם הנסיעה חוצה חצות, סמנו
            "מסתיים למחרת".
          </p>
        )}

        {isValid && startsInPast && (
          <p className="text-[13px] text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            שעת ההתחלה כבר עברה — השריון יתחיל באיחור.
          </p>
        )}

        {/* Long reservation notice */}
        {needsApproval && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25">
            <div className="flex items-start gap-2">
              <Hourglass className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" aria-hidden="true" />
              <p className="text-[13px] text-amber-800 dark:text-amber-300 leading-relaxed">
                <strong className="font-bold">{formatDuration(startFull, endFull)}</strong> זה מעל{' '}
                {threshold} שעות, לכן הבקשה תמתין לאישור של אבא או אמא. הם יקבלו
                הודעה בוואטסאפ.
              </p>
            </div>
          </div>
        )}

        {/* Shabbat overlap - blocks by default, overridable on purpose */}
        {hitsRestricted && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30">
            <div className="flex items-start gap-2 mb-2.5">
              <Sparkles className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" aria-hidden="true" />
              <p className="text-[13px] text-amber-800 dark:text-amber-300 leading-relaxed">
                הזמן הזה חופף ל{dayInfo?.title || 'שבת'} (
                {formatTime(dayInfo.restrictedFrom)} – {formatTime(dayInfo.restrictedUntil)}).
              </p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={shabbatAcknowledged}
                onChange={(event) => setShabbatAcknowledged(event.target.checked)}
                className="w-5 h-5 mt-0.5 shrink-0 rounded-md accent-amber-600 cursor-pointer"
              />
              <span className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">
                אני מאשר/ת בכל זאת (צורך מיוחד או חירום)
              </span>
            </label>
          </div>
        )}

        {/* Purpose */}
        <div>
          <label htmlFor="res-reason" className={labelClass}>
            לאן / למה? <span className="text-slate-400 font-normal">(לא חובה)</span>
          </label>
          <input
            id="res-reason"
            type="text"
            maxLength={120}
            placeholder="חוג, קניות, עבודה..."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={fieldClass}
          />
          <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-1">
            זה מה שהמשפחה תראה בלוח הזמנים.
          </p>
        </div>

        <div>
          <label htmlFor="res-notes" className={labelClass}>
            הערות <span className="text-slate-400 font-normal">(לא חובה)</span>
          </label>
          <input
            id="res-notes"
            type="text"
            maxLength={200}
            placeholder="מחזיר עם מיכל מלא, צריך כיסא תינוק..."
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className={fieldClass}
          />
        </div>

        {/* Errors, with recovery */}
        {error && (
          <div
            role="alert"
            className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 space-y-2.5"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" aria-hidden="true" />
              <p className="text-[13px] font-bold text-rose-700 dark:text-rose-300 leading-relaxed">
                {error}
              </p>
            </div>

            {conflict?.conflictingReservation && (
              <>
                <div className="p-2.5 rounded-xl bg-white/60 dark:bg-black/25 text-[13px]
                  text-slate-700 dark:text-slate-300">
                  <p>
                    <strong>{conflict.conflictingReservation.user?.name}</strong> נסע/ת{' '}
                    <span className="tabular" dir="ltr">
                      {formatTime(conflict.conflictingReservation.start_time)}–
                      {formatTime(conflict.conflictingReservation.end_time)}
                    </span>
                  </p>
                  {conflict.nextAvailable && (
                    <p className="mt-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                      הזמן הפנוי הקרוב: <span className="tabular">{formatTime(conflict.nextAvailable)}</span>
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {conflict.nextAvailable && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = new Date(conflict.nextAvailable);
                        handleStartChange(toTimeInput(next));
                        setError(null);
                        setConflict(null);
                      }}
                      className="w-full min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700
                        text-white font-bold text-[13px] apple-btn-active"
                    >
                      העבירו אותי ל-{formatTime(conflict.nextAvailable)}
                    </button>
                  )}

                  {waitlistJoined ? (
                    <p className="min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl
                      bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 font-bold text-[13px]">
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      נרשמת לרשימת ההמתנה
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={handleJoinWaitlist}
                      className="w-full min-h-[44px] rounded-xl bg-brand-600 hover:bg-brand-700
                        text-white font-bold text-[13px] apple-btn-active
                        inline-flex items-center justify-center gap-1.5"
                    >
                      <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
                      הודיעו לי אם יתפנה
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </form>
    </Sheet>
  );
}
