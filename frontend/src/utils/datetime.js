/**
 * Local-calendar date helpers.
 *
 * Every date bug in the first version came from one habit:
 *   new Date(dateStr + 'T00:00:00').toISOString().slice(0, 10)
 * That builds a LOCAL midnight and then formats it in UTC. In Israel (UTC+2/+3)
 * local midnight is 21:00 or 22:00 the previous day in UTC, so the date string
 * came back one day earlier. The visible symptoms were:
 *   - the "next day" arrow returned the same date, so it did nothing at all
 *   - the "previous day" arrow skipped two days back
 *   - between 00:00 and 03:00, "today" showed yesterday
 *
 * Use toDateKey() for anything that becomes a YYYY-MM-DD string. Never
 * toISOString() for a calendar day.
 */

/** YYYY-MM-DD for a Date, in the viewer's own timezone. */
export function toDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today, as a local YYYY-MM-DD key. */
export function todayKey() {
  return toDateKey(new Date());
}

/** A Date at local midnight of a YYYY-MM-DD key. */
export function fromDateKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
}

/** Shifts a YYYY-MM-DD key by whole days, staying in local time. */
export function addDaysToKey(key, days) {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

export function isToday(key) {
  return key === todayKey();
}

export function isTomorrow(key) {
  return key === addDaysToKey(todayKey(), 1);
}

export function isPastDay(key) {
  return key < todayKey();
}

/** Minutes to add to UTC to get local time. The server needs this to resolve
 *  "which day is this reservation on" the same way the client does. */
export function tzOffsetMinutes() {
  return -new Date().getTimezoneOffset();
}

// ----------------------------------------------------
// Formatting
// ----------------------------------------------------
const TIME_OPTS = { hour: '2-digit', minute: '2-digit' };

export function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('he-IL', TIME_OPTS);
}

export function formatDayName(key) {
  return fromDateKey(key).toLocaleDateString('he-IL', { weekday: 'long' });
}

export function formatLongDate(key) {
  return fromDateKey(key).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: fromDateKey(key).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
  });
}

/** "יום חמישי, 24 בספטמבר" for a Date or ISO string. */
export function formatFullDate(value) {
  return new Date(value).toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

/** "2.5 שעות" / "45 דקות" - a human duration. */
export function formatDuration(startIso, endIso) {
  const minutes = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  if (minutes < 60) return `${minutes} דקות`;
  const hours = minutes / 60;
  const label = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  if (hours === 1) return 'שעה';
  if (hours === 2) return 'שעתיים';
  return `${label} שעות`;
}

/** True when the two ISO instants fall on different local calendar days. */
export function spansMidnight(startIso, endIso) {
  return toDateKey(new Date(startIso)) !== toDateKey(new Date(endIso));
}

// ----------------------------------------------------
// Building an instant from the form's date + time inputs
// ----------------------------------------------------
/**
 * Combines a YYYY-MM-DD and an HH:MM into a real Date in local time.
 * `dayOffset` lets an end time roll over midnight (23:00 -> 01:00 next day),
 * which the single-date form previously could not express at all.
 */
export function combineDateTime(dateKey, timeStr, dayOffset = 0) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const [hour, minute] = String(timeStr).split(':').map(Number);
  return new Date(year, (month || 1) - 1, (day || 1) + dayOffset, hour || 0, minute || 0, 0, 0);
}

/** HH:MM for a Date, in local time. */
export function toTimeInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Rounds up to the next quarter hour - a sensible default start time. */
export function nextQuarterHour(from = new Date()) {
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d;
}

/** Adds minutes to an HH:MM string, reporting whether it crossed midnight. */
export function addMinutesToTime(timeStr, minutes) {
  const [hour, minute] = String(timeStr).split(':').map(Number);
  const total = (hour || 0) * 60 + (minute || 0) + minutes;
  const dayOffset = Math.floor(total / 1440);
  const wrapped = ((total % 1440) + 1440) % 1440;
  return {
    time: `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`,
    dayOffset
  };
}
