import { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  ChevronRight, ChevronLeft, Clock, Plus, CheckCircle2, CalendarDays,
  Hourglass, BellRing, WifiOff, Zap, Bell
} from 'lucide-react';
import ShabbatBanner from './ShabbatBanner';
import QuickActions from './QuickActions';
import {
  todayKey, addDaysToKey, isToday, isTomorrow, isPastDay,
  formatDayName, formatLongDate, formatTime, formatDuration, toDateKey, fromDateKey
} from '../utils/datetime';

// The hour grid the PRD asks for. Night hours stay reachable but collapsed by
// default, so the useful part of the day is what you see first.
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 24;

export default function TimelineView({ onOpenNewReservation, onSelectReservation, onRequestWaitlist }) {
  const {
    selectedDate, setSelectedDate, reservations, dayInfo,
    loading, hasLoadedOnce, loadError, refreshData, currentUser, myWaitlist
  } = useApp();

  const [showNightHours, setShowNightHours] = useState(false);
  const [shabbatOverride, setShabbatOverride] = useState(false);
  const nowMarkerRef = useRef(null);

  const viewingToday = isToday(selectedDate);
  const viewingPast = isPastDay(selectedDate);

  // Reset the override whenever the day changes: an override is a deliberate
  // per-day decision, not a setting that quietly persists.
  useEffect(() => setShabbatOverride(false), [selectedDate]);

  // Bring the current hour into view on today, and only when it is not already
  // on screen. Centring is safe because the date card above is sticky - an
  // earlier version scrolled the date out of sight, so the app opened mid-page
  // with no indication of which day you were looking at. 'center' also keeps
  // the marker clear of the floating tab bar at the bottom.
  useEffect(() => {
    if (!viewingToday || !hasLoadedOnce) return undefined;
    const timer = setTimeout(() => {
      const marker = nowMarkerRef.current;
      if (!marker) return;
      const rect = marker.getBoundingClientRect();
      const hidden = rect.top < 160 || rect.bottom > window.innerHeight - 150;
      if (hidden) marker.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 400);
    return () => clearTimeout(timer);
  }, [viewingToday, hasLoadedOnce, selectedDate]);

  const changeDate = (days) => setSelectedDate(addDaysToKey(selectedDate, days));

  /**
   * Lays each reservation onto the hour rows it actually covers, clipped to the
   * selected day - so a trip from 23:00 to 01:00 shows on both days with the
   * right partial hours, instead of vanishing from one of them.
   */
  const { rows, nightReservations, activeReservations } = useMemo(() => {
    const dayStart = fromDateKey(selectedDate).getTime();

    const visible = reservations.filter((r) => r.status !== 'cancelled');

    const hourRows = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const slotStart = dayStart + hour * 3600 * 1000;
      const slotEnd = slotStart + 3600 * 1000;
      const items = visible.filter((r) => {
        const s = new Date(r.start_time).getTime();
        const e = new Date(r.end_time).getTime();
        return s < slotEnd && e > slotStart;
      });
      hourRows.push({ hour, items });
    }

    return {
      rows: hourRows,
      nightReservations: hourRows
        .filter((row) => row.hour < DAY_START_HOUR)
        .reduce((sum, row) => sum + row.items.length, 0),
      activeReservations: visible
    };
  }, [reservations, selectedDate]);

  const visibleRows = showNightHours
    ? rows
    : rows.filter((row) => row.hour >= DAY_START_HOUR && row.hour < DAY_END_HOUR);

  const nowHour = new Date().getHours();
  const nowMinutes = new Date().getMinutes();

  const waitlistedIds = new Set(
    myWaitlist.map((w) => `${w.target_start}|${w.target_end}`)
  );

  const navBtn =
    'w-11 h-11 rounded-full flex items-center justify-center apple-btn-active ' +
    'text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10';

  return (
    <div className="mb-safe-content">
      {/* ---------------- Date navigation ---------------- */}
      <div className="glass-card rounded-[1.5rem] p-3 mb-3.5 sticky top-[4.75rem] z-20">
        <div className="flex items-center justify-between gap-2">
          {/* In RTL, "previous" points right and "next" points left. */}
          <button type="button" onClick={() => changeDate(-1)} aria-label="יום קודם" className={navBtn}>
            <ChevronRight className="w-5 h-5" aria-hidden="true" />
          </button>

          <div className="text-center min-w-0 flex-1">
            <h2 className="text-[17px] font-bold text-slate-900 dark:text-white leading-tight truncate">
              {isToday(selectedDate)
                ? 'היום'
                : isTomorrow(selectedDate)
                ? 'מחר'
                : formatDayName(selectedDate)}
            </h2>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {formatLongDate(selectedDate)}
              {!isToday(selectedDate) && !isTomorrow(selectedDate) && ''}
            </p>
          </div>

          <button type="button" onClick={() => changeDate(1)} aria-label="יום הבא" className={navBtn}>
            <ChevronLeft className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center justify-center gap-2 mt-2 pt-2.5 border-t border-black/5 dark:border-white/10">
          <button
            type="button"
            onClick={() => setSelectedDate(todayKey())}
            aria-pressed={viewingToday}
            className={`min-h-[44px] px-4 rounded-full text-[13px] font-semibold apple-btn-active ${
              viewingToday
                ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/25'
                : 'bg-black/5 dark:bg-white/10 text-slate-700 dark:text-slate-200'
            }`}
          >
            היום
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate(addDaysToKey(todayKey(), 1))}
            aria-pressed={isTomorrow(selectedDate)}
            className={`min-h-[44px] px-4 rounded-full text-[13px] font-semibold apple-btn-active ${
              isTomorrow(selectedDate)
                ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/25'
                : 'bg-black/5 dark:bg-white/10 text-slate-700 dark:text-slate-200'
            }`}
          >
            מחר
          </button>
          <label className="relative min-h-[44px] px-3.5 flex items-center gap-1.5 rounded-full
            bg-black/5 dark:bg-white/10 text-slate-700 dark:text-slate-200 text-[13px]
            font-semibold cursor-pointer apple-btn-active">
            <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
            <span>תאריך</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => event.target.value && setSelectedDate(event.target.value)}
              aria-label="בחרו תאריך"
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
        </div>
      </div>

      {/* ---------------- Shabbat / chag ---------------- */}
      <ShabbatBanner
        dayInfo={dayInfo}
        selectedDate={selectedDate}
        override={shabbatOverride}
        onToggleOverride={setShabbatOverride}
      />

      {/* ---------------- Quick actions (today only) ---------------- */}
      {viewingToday && <QuickActions />}

      {/* ---------------- Connection error ---------------- */}
      {loadError && (
        <div className="glass-card rounded-2xl p-4 mb-3.5 border border-amber-500/25 bg-amber-500/5">
          <div className="flex items-start gap-2.5">
            <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-amber-800 dark:text-amber-300">
                לא הצלחנו לרענן את הלו״ז
              </p>
              <p className="text-[13px] text-amber-800/75 dark:text-amber-300/75 mt-0.5 leading-relaxed">
                {loadError}
              </p>
            </div>
            <button
              type="button"
              onClick={() => refreshData()}
              className="min-h-[44px] px-3.5 rounded-xl bg-amber-600 text-white text-[13px] font-bold apple-btn-active shrink-0"
            >
              רענון
            </button>
          </div>
        </div>
      )}

      {/* ---------------- Section heading ---------------- */}
      <div className="flex items-center justify-between px-1 mb-2">
        <h3 className="text-[13px] font-bold text-slate-500 dark:text-slate-400">
          לוח הזמנים
          {hasLoadedOnce && (
            <span className="text-slate-400 dark:text-slate-500 font-semibold">
              {' · '}
              {activeReservations.length === 0
                ? 'פנוי'
                : `${activeReservations.length} שריונים`}
            </span>
          )}
        </h3>

        {nightReservations > 0 || showNightHours ? (
          <button
            type="button"
            onClick={() => setShowNightHours((prev) => !prev)}
            className="min-h-[44px] px-3 rounded-lg text-[12px] font-semibold text-brand-600
              dark:text-brand-400 hover:bg-brand-600/10 apple-btn-active"
          >
            {showNightHours ? 'הסתרת שעות הלילה' : `שעות הלילה${nightReservations ? ` (${nightReservations})` : ''}`}
          </button>
        ) : null}
      </div>

      {/* ---------------- Loading skeleton ----------------
          Shown only before the first successful load. The old view rendered
          "the car is completely free!" while data was still in flight. */}
      {!hasLoadedOnce && loading && (
        <div className="space-y-2" aria-busy="true" aria-label="טוען את לוח הזמנים">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="flex items-stretch gap-3">
              <div className="skeleton w-11 h-5 rounded-md shrink-0 mt-1" />
              <div className="skeleton flex-1 h-14 rounded-2xl" />
            </div>
          ))}
        </div>
      )}

      {/* ---------------- Empty day ---------------- */}
      {hasLoadedOnce && activeReservations.length === 0 && (
        <div className="glass-card rounded-[1.5rem] p-7 text-center border border-dashed border-slate-300 dark:border-neutral-700">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400
            flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
          </div>
          <h4 className="text-[16px] font-bold text-slate-800 dark:text-slate-100">
            {viewingPast ? 'לא היו שריונים ביום הזה' : 'הרכב פנוי כל היום'}
          </h4>
          {!viewingPast && (
            <>
              <p className="text-[14px] text-slate-500 dark:text-slate-400 mt-1 max-w-[16rem] mx-auto leading-relaxed">
                אף אחד לא שריין. כל שעה פתוחה.
              </p>
              <button
                type="button"
                onClick={onOpenNewReservation}
                className="mt-4 min-h-[44px] px-5 rounded-full bg-brand-600 hover:bg-brand-700 text-white
                  text-[15px] font-bold apple-btn-active inline-flex items-center gap-2 shadow-lg shadow-brand-600/25"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>שריון ראשון</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* ---------------- The hour list (PRD section 3) ---------------- */}
      {hasLoadedOnce && activeReservations.length > 0 && (
        <ol className="space-y-px">
          {visibleRows.map(({ hour, items }) => {
            const isCurrentHour = viewingToday && hour === nowHour;
            const hourLabel = `${String(hour).padStart(2, '0')}:00`;

            return (
              <li key={hour} className="relative">
                <div className="flex items-stretch gap-3 min-h-[3rem]">
                  {/* Hour gutter */}
                  <div className="w-11 shrink-0 pt-1.5 text-end relative">
                    <span
                      className={`text-[12px] font-semibold tabular ${
                        isCurrentHour
                          ? 'text-brand-600 dark:text-brand-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {hourLabel}
                    </span>
                  </div>

                  {/* Slot content */}
                  <div className="flex-1 min-w-0 border-s border-black/[0.07] dark:border-white/[0.07] ps-3 pb-1">
                    {/* "Now" marker */}
                    {isCurrentHour && (
                      <div
                        ref={nowMarkerRef}
                        className="absolute -start-0 right-11 left-0 flex items-center gap-1.5 pointer-events-none z-10"
                        style={{ top: `${(nowMinutes / 60) * 3}rem` }}
                        aria-hidden="true"
                      >
                        <span className="w-2 h-2 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50 shrink-0" />
                        <span className="flex-1 h-px bg-rose-500/45" />
                      </div>
                    )}

                    {items.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => onOpenNewReservation({ hour })}
                        disabled={viewingPast}
                        aria-label={`שריון פנוי בשעה ${hourLabel}`}
                        className="w-full min-h-[44px] rounded-xl text-start px-3 group
                          hover:bg-brand-600/[0.07] dark:hover:bg-brand-400/[0.09]
                          disabled:hover:bg-transparent disabled:cursor-default
                          apple-btn-active transition-colors"
                      >
                        <span className="text-[13px] text-slate-400 dark:text-slate-600
                          group-hover:text-brand-600 dark:group-hover:text-brand-400
                          group-disabled:group-hover:text-slate-400 font-medium">
                          {viewingPast ? '—' : 'פנוי'}
                        </span>
                      </button>
                    ) : (
                      <div className="space-y-1.5">
                        {items.map((res) => {
                          // Draw the card once, on the hour the trip starts (or
                          // on the first visible hour when it began earlier).
                          const startHour = new Date(res.start_time).getHours();
                          const startsToday = toDateKey(new Date(res.start_time)) === selectedDate;
                          const firstVisibleHour = showNightHours ? 0 : DAY_START_HOUR;
                          const anchorHour = startsToday
                            ? Math.max(startHour, firstVisibleHour)
                            : firstVisibleHour;
                          if (hour !== anchorHour) {
                            return (
                              <div
                                key={res.id}
                                className="h-1.5 rounded-full opacity-35"
                                style={{ backgroundColor: res.user?.color || '#0071E3' }}
                                aria-hidden="true"
                              />
                            );
                          }

                          return (
                            <ReservationCard
                              key={res.id}
                              reservation={res}
                              currentUser={currentUser}
                              onSelect={onSelectReservation}
                              onRequestWaitlist={onRequestWaitlist}
                              isWaitlisted={waitlistedIds.has(`${res.start_time}|${res.end_time}`)}
                              continuesFromYesterday={!startsToday}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/**
 * One reservation. Status is conveyed by an icon and a word as well as colour,
 * so it does not depend on colour alone.
 */
function ReservationCard({
  reservation, currentUser, onSelect, onRequestWaitlist, isWaitlisted, continuesFromYesterday
}) {
  const color = reservation.user?.color || '#0071E3';
  const isMine = reservation.user_id === currentUser?.id;
  const isPending = reservation.status === 'pending_approval';
  const isDone = reservation.status === 'completed';
  const isActive =
    reservation.status === 'confirmed' &&
    new Date(reservation.start_time) <= new Date() &&
    new Date(reservation.end_time) > new Date();
  const isFuture = new Date(reservation.start_time) > new Date();

  return (
    <div
      className={`glass-card rounded-2xl overflow-hidden apple-press-card transition-opacity
        ${isDone ? 'opacity-60' : ''}`}
      style={{ borderInlineStartWidth: '4px', borderInlineStartColor: color }}
    >
      <button
        type="button"
        onClick={() => onSelect(reservation)}
        className="w-full text-start p-3 min-h-[44px]"
        aria-label={`פרטי השריון של ${reservation.user?.name} בשעה ${formatTime(reservation.start_time)}`}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-[13px] shrink-0"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          >
            {reservation.user?.name?.slice(0, 2) || '??'}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[15px] font-bold text-slate-900 dark:text-white">
                {reservation.user?.name}
              </span>
              {isMine && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-brand-600/12
                  text-brand-700 dark:text-brand-300 font-bold">
                  את/ה
                </span>
              )}
              {isActive && (
                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md
                  bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
                  בנסיעה
                </span>
              )}
              {isPending && (
                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md
                  bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold">
                  <Hourglass className="w-2.5 h-2.5" aria-hidden="true" />
                  ממתין לאישור
                </span>
              )}
              {isDone && (
                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md
                  bg-slate-500/15 text-slate-600 dark:text-slate-400 font-bold">
                  <CheckCircle2 className="w-2.5 h-2.5" aria-hidden="true" />
                  הוחזר
                </span>
              )}
              {reservation.is_quick_ride && (
                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md
                  bg-violet-500/15 text-violet-700 dark:text-violet-400 font-bold">
                  <Zap className="w-2.5 h-2.5" aria-hidden="true" />
                  קפיצה
                </span>
              )}
            </div>

            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {continuesFromYesterday && '⟵ מאתמול · '}
              {reservation.reason}
            </p>
          </div>

          <div className="shrink-0 text-end">
            <div className="inline-flex items-center gap-1 text-[13px] font-bold
              text-slate-700 dark:text-slate-200 tabular">
              <Clock className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
              <time dir="ltr" dateTime={reservation.start_time}>
                {formatTime(reservation.start_time)}–{formatTime(reservation.end_time)}
              </time>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
              {formatDuration(reservation.start_time, reservation.end_time)}
            </p>
          </div>
        </div>
      </button>

      {/* "Tell me when it frees up" - the PRD's standby feature, reachable from a
          taken slot. It used to exist only after a failed booking attempt. */}
      {!isMine && !isDone && (isActive || isFuture) && (
        <div className="px-3 pb-2.5 -mt-0.5">
          <button
            type="button"
            onClick={() => onRequestWaitlist(reservation)}
            disabled={isWaitlisted}
            className={`w-full min-h-[44px] rounded-xl text-[13px] font-semibold
              inline-flex items-center justify-center gap-1.5 apple-btn-active border
              ${isWaitlisted
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25'
                : 'bg-black/[0.04] dark:bg-white/[0.06] text-slate-600 dark:text-slate-300 border-transparent hover:border-brand-500/40'
              }`}
          >
            {isWaitlisted ? (
              <>
                <Bell className="w-3.5 h-3.5" aria-hidden="true" />
                <span>ברשימת ההמתנה — נודיע לך</span>
              </>
            ) : (
              <>
                <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
                <span>הודיעו לי אם יתפנה</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
