/**
 * Israeli Jewish calendar: Shabbat and Yom Tov detection with real time boundaries.
 *
 * The previous version marked the whole of Friday and the whole of Saturday as
 * "driving forbidden", which is wrong in both directions: Friday morning is an
 * ordinary (in fact very busy) driving time, and Saturday night after havdalah
 * is too. It also fetched the candle-lighting and havdalah times and then never
 * used them for anything except display.
 *
 * Now the restriction is a time window: it starts at candle lighting and ends at
 * havdalah, and the UI gets both boundaries so it can block only those hours.
 */

const TZ = 'Asia/Jerusalem';
const JERUSALEM_GEONAME = 281184;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

// Keyed by YYYY-MM (the API is queried a month at a time).
const monthCache = new Map();

function todayInIsrael() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
}

/** Day of week for a plain YYYY-MM-DD, with no timezone drift. */
function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun .. 5 Fri, 6 Sat
}

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Israel's UTC offset in minutes for a given calendar day. */
function offsetMinutesFor(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  const asIfUtc = new Date(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    })
      .format(noonUtc)
      .replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/, '$3-$1-$2T$4:$5:$6Z')
  );
  return Math.round((asIfUtc.getTime() - noonUtc.getTime()) / 60000);
}

/** "2026-09-25" + "17:52" -> exact UTC instant. */
function toInstant(dateStr, hhmm) {
  if (!dateStr || !hhmm) return null;
  const match = String(hhmm).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const offset = offsetMinutesFor(dateStr);
  return new Date(Date.UTC(y, m - 1, d, Number(match[1]), Number(match[2])) - offset * 60000).toISOString();
}

async function fetchMonth(year, month) {
  const key = year + '-' + String(month).padStart(2, '0');
  const cached = monthCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.items;
  }

  const url =
    'https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&nx=off&ss=off&mf=off' +
    '&year=' + year + '&month=' + month +
    '&c=on&geo=geoname&geonameid=' + JERUSALEM_GEONAME + '&m=50&i=on&lg=h';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('Hebcal responded with ' + res.status);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    monthCache.set(key, { items, fetchedAt: Date.now() });
    return items;
  } catch (err) {
    // Serve a stale month rather than nothing at all.
    if (cached) {
      console.warn('[Hebcal] Using cached data for ' + key + ' (' + err.message + ')');
      return cached.items;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the day's status plus the exact window in which driving is restricted.
 *
 * restrictedFrom / restrictedUntil are ISO instants (or null). The UI blocks
 * only the hours inside that window, and an override is still possible - the
 * PRD asks for a visual block with a functional override, not a hard lock.
 */
export async function getDayStatus(dateStr) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '')) ? dateStr : todayInIsrael();
  const dow = dayOfWeek(date);

  const result = {
    date,
    isShabbat: false,
    isYomTov: false,
    isErevShabbat: false,
    isDrivingRestricted: false,
    restrictedFrom: null,
    restrictedUntil: null,
    title: '',
    holidayTitle: '',
    candleLighting: null,
    havdalah: null,
    source: 'local'
  };

  // Offline baseline: Friday evening through Saturday night. Times are
  // approximations only, and are replaced by real ones when the API answers.
  if (dow === 5) {
    result.isErevShabbat = true;
    result.title = 'ערב שבת';
  } else if (dow === 6) {
    result.isShabbat = true;
    result.title = 'שבת קודש';
  }

  try {
    const [year, month] = date.split('-').map(Number);
    // A Saturday's havdalah and a Friday's candle lighting can fall in
    // neighbouring months, so fetch the adjacent month too when near an edge.
    const items = await fetchMonth(year, month);
    const dayNum = Number(date.slice(8, 10));
    let extra = [];
    if (dayNum <= 2 || dayNum >= 27) {
      const neighbour = dayNum <= 2 ? shiftDate(date, -3) : shiftDate(date, 3);
      const [ny, nm] = neighbour.split('-').map(Number);
      if (ny !== year || nm !== month) {
        extra = await fetchMonth(ny, nm).catch(() => []);
      }
    }
    const all = items.concat(extra);
    result.source = 'hebcal';

    const onDate = (d) => all.filter((item) => item.date && item.date.startsWith(d));
    const timeOf = (item) => {
      // Candle/havdalah items carry a full ISO date with time.
      if (item.date && item.date.length > 10) return item.date;
      const m = String(item.title || '').match(/(\d{1,2}:\d{2})/);
      return m ? toInstant(item.date?.slice(0, 10), m[1]) : null;
    };

    const todayEvents = onDate(date);
    const candles = todayEvents.find((e) => e.category === 'candles');
    const havdalah = todayEvents.find((e) => e.category === 'havdalah');
    const yomTov = todayEvents.find((e) => e.yomtov === true);
    const holiday = todayEvents.find((e) => e.category === 'holiday');

    if (yomTov) {
      result.isYomTov = true;
      result.holidayTitle = yomTov.hebrew || yomTov.title || '';
    }
    if (holiday && !result.holidayTitle) {
      result.holidayTitle = holiday.hebrew || holiday.title || '';
    }
    // The holiday name wins over the generic "שבת קודש" label. The old code set
    // `title` from the weekday first and then skipped the API name entirely, so
    // a chag falling on Friday was always shown as plain "ערב שבת קודש".
    if (result.holidayTitle) {
      result.title = result.isShabbat ? result.holidayTitle + ' (שבת)' : result.holidayTitle;
    }

    if (candles) {
      result.candleLighting = timeOf(candles);
      result.isErevShabbat = true;
      // Restriction starts at candle lighting, not at midnight.
      result.restrictedFrom = result.candleLighting;
      // It ends at the next havdalah, which is normally the following evening.
      for (let ahead = 1; ahead <= 3; ahead += 1) {
        const next = onDate(shiftDate(date, ahead)).find((e) => e.category === 'havdalah');
        if (next) {
          result.restrictedUntil = timeOf(next);
          break;
        }
      }
    }

    if (havdalah) {
      result.havdalah = timeOf(havdalah);
      if (!result.restrictedFrom) {
        // Saturday (or the last day of a chag): restricted from midnight until havdalah.
        result.restrictedFrom = toInstant(date, '00:00');
        result.restrictedUntil = result.havdalah;
      }
    }

    // A middle day of a multi-day chag: no candles and no havdalah of its own.
    if (!candles && !havdalah && yomTov) {
      result.restrictedFrom = toInstant(date, '00:00');
      result.restrictedUntil = toInstant(shiftDate(date, 1), '00:00');
    }

    if (!result.title) {
      const anyNamed = todayEvents.find((e) => e.hebrew || e.title);
      if (anyNamed) result.title = anyNamed.hebrew || anyNamed.title;
    }
  } catch (err) {
    // Offline: approximate Friday 18:00 -> Saturday 20:00 and say so, so the UI
    // can show that these are estimates rather than exact halachic times.
    console.warn('[Hebcal] Offline fallback for ' + date + ': ' + err.message);
    if (dow === 5) {
      result.restrictedFrom = toInstant(date, '18:00');
      result.restrictedUntil = toInstant(shiftDate(date, 1), '20:00');
    } else if (dow === 6) {
      result.restrictedFrom = toInstant(date, '00:00');
      result.restrictedUntil = toInstant(date, '20:00');
    }
  }

  result.isDrivingRestricted = !!(result.restrictedFrom && result.restrictedUntil);
  return result;
}

/** True when a whole reservation window sits inside the restricted hours. */
export function isWindowRestricted(dayStatus, startIso, endIso) {
  if (!dayStatus?.restrictedFrom || !dayStatus?.restrictedUntil) return false;
  const from = new Date(dayStatus.restrictedFrom).getTime();
  const until = new Date(dayStatus.restrictedUntil).getTime();
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return start < until && end > from; // any overlap
}
