import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Hebrew NLP for the family car WhatsApp bot.
 *
 * Two engines:
 *  1. Gemini, when GEMINI_API_KEY is configured - constrained by a response
 *     schema so it cannot answer with prose or markdown fences.
 *  2. A local heuristic parser, used when there is no key and as the fallback
 *     when the API call fails. It has to be good enough to stand on its own.
 */

const TZ = 'Asia/Jerusalem';
const TRIGGER = /^רכב\s*/;

// Words that describe *when*, which must not survive into the trip's purpose.
const TIME_WORDS = [
  'מחרתיים', 'מחר', 'היום', 'עכשיו', 'הלילה', 'בלילה', 'בערב', 'הערב',
  'בבוקר', 'הבוקר', 'בצהריים', 'הצהריים', 'אחהצ', 'אחרי הצהריים',
  'בשעה', 'משעה', 'עד השעה', 'עד', 'בין', 'לבין', 'שעות', 'שעה', 'דקות', 'דק',
  'שעתיים', 'לשעתיים', 'לשעה', 'חצי שעה', 'לחצי שעה',
  'אני', 'צריך', 'צריכה', 'רוצה', 'לוקח', 'לוקחת', 'קח', 'תן לי', 'אפשר',
  'בבקשה', 'תודה', 'לשריין', 'שריון', 'להזמין'
];

const DAY_NAMES = {
  'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6
};

/** Current wall-clock parts in Israel, regardless of the server's own timezone. */
function israelParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** Israel's UTC offset in minutes on a given date (+120 winter, +180 summer). */
function israelOffsetMinutes(date = new Date()) {
  const asIfUtc = new Date(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(date).replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/, '$3-$1-$2T$4:$5:$6Z')
  );
  return Math.round((asIfUtc.getTime() - date.getTime()) / 60000);
}

/** Builds an exact UTC instant from an Israel-local wall-clock time. */
function israelWallClockToDate({ year, month, day, hour, minute = 0 }) {
  // Israel is UTC+2/+3, so guessing with the offset of that day's noon is safe.
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offset = israelOffsetMinutes(probe);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offset * 60000);
}

function addDays({ year, month, day }, days) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Extracts the trip purpose without destroying it.
 * The old version ran one big regex over the text and turned
 * "מחר מ-16:00 עד 19:00 לחוג" into "מ- עד  לחוג".
 */
function extractReason(text, fallback = 'נסיעה') {
  let s = ' ' + text + ' ';

  // NOTE: \b is useless next to Hebrew. It is defined in terms of \w
  // ([A-Za-z0-9_]), and Hebrew letters are not \w, so there is no boundary
  // between a space and "מ" - every /\bמ.../ pattern silently matched nothing.
  // Space anchors are used instead throughout this file.
  const B = '(^|[\\s,.])'; // start-of-word anchor that works for Hebrew

  // Whole time expressions first, so no stray prepositions are left behind.
  s = s.replace(new RegExp(B + 'מ\\s*[-־]?\\s*\\d{1,2}(:\\d{2})?\\s*(עד|ועד|-|–)\\s*(השעה\\s*)?\\d{1,2}(:\\d{2})?', 'g'), ' ');
  s = s.replace(new RegExp(B + 'בין\\s*[-־]?\\s*\\d{1,2}(:\\d{2})?\\s*(ל|לבין|עד)\\s*[-־]?\\s*\\d{1,2}(:\\d{2})?', 'g'), ' ');
  s = s.replace(new RegExp(B + '(בשעה|משעה|מהשעה|לשעה|בסביבות|עד|מ|ב)\\s*[-־]?\\s*\\d{1,2}(:\\d{2})?', 'g'), ' ');
  s = s.replace(new RegExp(B + 'ל?\\s*\\d{1,3}\\s*(שעות|שעה|דקות|דק\'?)', 'g'), ' ');
  s = s.replace(/\d{1,2}:\d{2}/g, ' ');
  // Bare leftover digits that were part of a time expression.
  s = s.replace(new RegExp(B + '\\d{1,2}(?=[\\s,.]|$)', 'g'), ' ');

  for (const word of TIME_WORDS) {
    s = s.replace(new RegExp(B + word + '(?=[\\s,.]|$)', 'g'), ' ');
  }
  for (const day of Object.keys(DAY_NAMES)) {
    s = s.replace(new RegExp(B + '(ביום|יום|ב)?\\s*' + day + '(?=[\\s,.]|$)', 'g'), ' ');
  }

  // Leftover bare prepositions and punctuation.
  s = s.replace(new RegExp(B + '(מ|ב|ל|עד|של|את|עם|כ|כדי)[-־]?(?=[\\s,.]|$)', 'g'), ' ');
  s = s.replace(/[-־,.]+/g, ' ').replace(/\s+/g, ' ').trim();

  // "לחוג" / "לקניות" keep their leading ל on purpose - it reads naturally.
  return s.length >= 2 ? s : fallback;
}

/**
 * Applies AM/PM intent in Hebrew.
 * Hebrew speakers say "ב-8 בערב" (20:00) and "ב-8 בבוקר" (08:00); a bare "ב-8"
 * in the evening almost always means tonight, not tomorrow morning.
 */
function applyDaypart(hour, text, { nowHour } = {}) {
  const evening = /בערב|הערב|בלילה|הלילה|אחהצ|אחרי הצהריים|בצהריים/.test(text);
  const morning = /בבוקר|הבוקר|לפנות בוקר/.test(text);

  if (evening && hour >= 1 && hour <= 11) return hour + 12;
  if (morning && hour === 12) return 0;
  if (morning) return hour;
  // No daypart stated: nudge an ambiguous small hour to the coming evening.
  if (!evening && !morning && hour >= 1 && hour <= 7 && nowHour !== undefined && nowHour >= 12) {
    return hour + 12;
  }
  return hour;
}

function heuristicHebrewParser(rawText, now, familyUsers = []) {
  const text = String(rawText).replace(TRIGGER, '').trim();
  const lower = text.toLowerCase();
  const nowParts = israelParts(now);

  const base = {
    action: 'clarify',
    start: null,
    end: null,
    user_name: null,
    reason: '',
    is_quick_ride: false,
    clarification_question: null
  };

  // ---------- Intent: status ----------
  if (/מי לוקח|מי לקח|איפה הרכב|מי עם הרכב|מה המצב|הרכב פנוי|יש רכב|פנוי\?|מי נוסע/.test(lower)) {
    return { ...base, action: 'status' };
  }

  // ---------- Intent: cancel ----------
  if (/^(בטל|לבטל|תבטל|ביטול)|לא צריך|מבטל|ויתרתי/.test(lower)) {
    return { ...base, action: 'cancel', reason: 'ביטול שריון' };
  }

  // ---------- Intent: quick ride ----------
  const quickMatch = lower.match(/(\d{1,2})\s*(דקות|דק'?)/);
  if (/קפיצה|רגע|דקה|מכולת|סופר|לזרוק|להקפיץ/.test(lower) || quickMatch) {
    const minutes = quickMatch ? Math.min(Math.max(parseInt(quickMatch[1], 10), 5), 60) : 15;
    return {
      ...base,
      action: 'reserve',
      start: now.toISOString(),
      end: new Date(now.getTime() + minutes * 60000).toISOString(),
      reason: extractReason(text, 'קפיצה קצרה'),
      is_quick_ride: true
    };
  }

  // ---------- Which day ----------
  let dayParts = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
  let dayExplicit = false;

  if (/מחרתיים/.test(lower)) {
    dayParts = addDays(dayParts, 2);
    dayExplicit = true;
  } else if (/מחר/.test(lower)) {
    dayParts = addDays(dayParts, 1);
    dayExplicit = true;
  } else if (/היום|עכשיו|הערב|הלילה/.test(lower)) {
    dayExplicit = true;
  } else {
    // "ביום חמישי" / "בשבת"
    for (const [name, dow] of Object.entries(DAY_NAMES)) {
      if (new RegExp('(ביום|יום|ב)\\s*' + name).test(lower)) {
        const todayDow = new Date(Date.UTC(dayParts.year, dayParts.month - 1, dayParts.day)).getUTCDay();
        let delta = (dow - todayDow + 7) % 7;
        if (delta === 0) delta = 7; // "ביום חמישי" on a Thursday means next week
        dayParts = addDays(dayParts, delta);
        dayExplicit = true;
        break;
      }
    }
  }

  // ---------- Which hours ----------
  // Two things the old version got wrong, both fixed here:
  //  - "ב-8" / "מ-16:00": the hyphen was not allowed, so every hyphenated time
  //    failed to parse and the bot always asked for clarification.
  //  - \b was used as a word anchor, which does nothing next to Hebrew letters.
  const A = '(?:^|[\\s,.])'; // start-of-word anchor that works for Hebrew
  const H = '(\\d{1,2})(?::(\\d{2}))?';

  const rangeMatch =
    text.match(new RegExp(A + '(?:משעה|מהשעה|מ)\\s*[-־]?\\s*' + H + '\\s*(?:עד|ועד|–|-)\\s*(?:השעה\\s*)?' + H)) ||
    text.match(new RegExp(A + 'בין\\s*[-־]?\\s*' + H + '\\s*(?:ל|לבין|עד)\\s*[-־]?\\s*' + H)) ||
    text.match(new RegExp(A + H + '\\s*(?:עד|–)\\s*' + H));

  const singleMatch =
    text.match(new RegExp(A + '(?:בשעה|לשעה|בסביבות|ב)\\s*[-־]?\\s*' + H)) ||
    text.match(new RegExp('^\\s*' + H + '(?=[\\s,.]|$)'));

  // Hebrew spells small durations as words: "לשעתיים", "לשלוש שעות".
  const WORD_HOURS = { 'חצי שעה': 0.5, 'שעה': 1, 'שעתיים': 2, 'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6 };
  let durationHours = null;
  const numericDuration = lower.match(new RegExp(A + 'ל?\\s*[-־]?\\s*(\\d{1,2})\\s*(?:שעות|שעה)'));
  if (numericDuration) {
    durationHours = parseInt(numericDuration[1], 10);
  } else {
    for (const [word, hours] of Object.entries(WORD_HOURS)) {
      if (new RegExp(A + 'ל?' + word + '(?:[\\s,.]|$)').test(lower + ' ')) {
        durationHours = hours;
        break;
      }
    }
  }

  let startHour = null;
  let startMin = 0;
  let endHour = null;
  let endMin = 0;

  if (rangeMatch) {
    startHour = applyDaypart(parseInt(rangeMatch[1], 10), lower, { nowHour: nowParts.hour });
    startMin = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
    endHour = applyDaypart(parseInt(rangeMatch[3], 10), lower, { nowHour: nowParts.hour });
    endMin = rangeMatch[4] ? parseInt(rangeMatch[4], 10) : 0;
    // An end that is not after the start simply crosses midnight; the date
    // rollover below handles it. Adding 12 here turned "23:00 עד 01:00" into
    // a 14-hour booking that ended at 13:00 the next day.
  } else if (singleMatch) {
    startHour = applyDaypart(parseInt(singleMatch[1], 10), lower, { nowHour: nowParts.hour });
    startMin = singleMatch[2] ? parseInt(singleMatch[2], 10) : 0;
    const hours = durationHours ?? 2;
    const totalMinutes = Math.round(Math.min(Math.max(hours, 0.5), 12) * 60);
    const endTotal = startHour * 60 + startMin + totalMinutes;
    endHour = Math.floor(endTotal / 60);
    endMin = endTotal % 60;
  } else if (durationHours !== null && /עכשיו|היום|כרגע/.test(lower)) {
    // "רכב עכשיו לשעתיים"
    const hours = Math.min(Math.max(durationHours, 0.5), 12);
    return {
      ...base,
      action: 'reserve',
      start: now.toISOString(),
      end: new Date(now.getTime() + hours * 3600000).toISOString(),
      reason: extractReason(text),
      user_name: familyUsers.find((u) => new RegExp('(^|\\s)' + u.name + '($|\\s)').test(text))?.name || null
    };
  }

  if (startHour === null) {
    return {
      ...base,
      action: 'clarify',
      reason: extractReason(text),
      clarification_question: dayExplicit
        ? 'לאיזו שעה בדיוק? כתוב למשל: "רכב מחר מ-18:00 עד 20:00"'
        : 'מתי תרצה את הרכב, ועד איזו שעה? למשל: "רכב מחר מ-18:00 עד 20:00"'
    };
  }

  if (startHour < 0 || startHour > 47 || startMin > 59 || endMin > 59) {
    return { ...base, action: 'clarify', clarification_question: 'לא הצלחתי לקרוא את השעה. נסה בפורמט 18:00' };
  }

  let startDate = israelWallClockToDate({ ...dayParts, hour: startHour % 24, minute: startMin });
  if (startHour >= 24) startDate = new Date(startDate.getTime() + 24 * 3600000);

  let endDate = israelWallClockToDate({ ...dayParts, hour: endHour % 24, minute: endMin });
  if (endHour >= 24) endDate = new Date(endDate.getTime() + 24 * 3600000);

  // Crossing midnight: 23:00 -> 01:00 belongs to the next day.
  if (endDate <= startDate) {
    endDate = new Date(endDate.getTime() + 24 * 3600000);
  }

  // No day was stated and the time already passed today - they mean tomorrow.
  if (!dayExplicit && startDate.getTime() < now.getTime() - 5 * 60000) {
    startDate = new Date(startDate.getTime() + 24 * 3600000);
    endDate = new Date(endDate.getTime() + 24 * 3600000);
  }

  const named = familyUsers.find((u) => new RegExp('(^|\\s)' + u.name + '($|\\s)').test(text));

  return {
    ...base,
    action: 'reserve',
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    user_name: named?.name || null,
    reason: extractReason(text)
  };
}

// ----------------------------------------------------
// Gemini path
// ----------------------------------------------------
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    action: { type: Type.STRING, enum: ['reserve', 'cancel', 'status', 'clarify'] },
    start: { type: Type.STRING, nullable: true, description: 'ISO 8601 with an Israel offset, or null' },
    end: { type: Type.STRING, nullable: true, description: 'ISO 8601 with an Israel offset, or null' },
    user_name: { type: Type.STRING, nullable: true },
    reason: { type: Type.STRING },
    is_quick_ride: { type: Type.BOOLEAN },
    clarification_question: { type: Type.STRING, nullable: true }
  },
  required: ['action', 'reason', 'is_quick_ride']
};

/** Survives markdown fences, stray prose, and an empty response. */
function safeJsonParse(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('Gemini returned an empty response');
  let text = raw.trim();
  // Strip ```json ... ``` if the model adds it despite instructions.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    // Last resort: the outermost JSON object in the text.
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return JSON.parse(text.slice(first, last + 1));
    }
    throw new Error('Gemini response was not valid JSON');
  }
}

/** A model can hallucinate a shape; validate before it reaches the database. */
function normalise(parsed, fallback) {
  if (!parsed || typeof parsed !== 'object') return fallback;

  const validActions = ['reserve', 'cancel', 'status', 'clarify'];
  const action = validActions.includes(parsed.action) ? parsed.action : null;
  if (!action) return fallback;

  const toIso = (value) => {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  };

  const start = toIso(parsed.start);
  const end = toIso(parsed.end);

  // A "reserve" without usable times is really a clarification request.
  if (action === 'reserve' && (!start || !end || new Date(end) <= new Date(start))) {
    return {
      action: 'clarify',
      start: null,
      end: null,
      user_name: typeof parsed.user_name === 'string' ? parsed.user_name : null,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 280) : '',
      is_quick_ride: false,
      clarification_question:
        typeof parsed.clarification_question === 'string' && parsed.clarification_question.trim()
          ? parsed.clarification_question.slice(0, 280)
          : 'לאיזו שעה בדיוק תרצה את הרכב, ועד מתי?'
    };
  }

  return {
    action,
    start,
    end,
    user_name: typeof parsed.user_name === 'string' && parsed.user_name.trim() ? parsed.user_name.trim().slice(0, 40) : null,
    reason: typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim().slice(0, 280) : 'נסיעה',
    is_quick_ride: parsed.is_quick_ride === true,
    clarification_question:
      typeof parsed.clarification_question === 'string' && parsed.clarification_question.trim()
        ? parsed.clarification_question.slice(0, 280)
        : null
  };
}

export async function parseCarMessage({ messageText, senderName, familyUsers = [] }) {
  const now = new Date();
  const apiKey = process.env.GEMINI_API_KEY;
  const textWithoutTrigger = String(messageText || '').replace(TRIGGER, '').trim();

  const heuristic = () => {
    const result = heuristicHebrewParser(messageText, now, familyUsers);
    if (!result.user_name) result.user_name = senderName || null;
    return result;
  };

  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    return heuristic();
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const usersList = familyUsers.map((u) => '- ' + u.name).join('\n');
    const israelNow = now.toLocaleString('he-IL', { timeZone: TZ });
    const offsetMinutes = israelOffsetMinutes(now);
    const offsetLabel = (offsetMinutes >= 0 ? '+' : '-') +
      String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0') + ':' +
      String(Math.abs(offsetMinutes) % 60).padStart(2, '0');

    const prompt = [
      'אתה מנוע פענוח עבור מערכת שיתוף רכב משפחתי. תפקידך היחיד: להמיר הודעה בעברית לאובייקט מובנה.',
      '',
      'הודעת המשתמש: "' + textWithoutTrigger + '"',
      'שם השולח: ' + (senderName || 'לא ידוע'),
      'הזמן הנוכחי בישראל: ' + israelNow + ' (ISO: ' + now.toISOString() + ', היסט: ' + offsetLabel + ')',
      '',
      'בני המשפחה:',
      usersList,
      '',
      'חוקים:',
      '1. start ו-end בפורמט ISO 8601 עם ההיסט ' + offsetLabel + ' (למשל 2026-09-24T18:00:00' + offsetLabel + ').',
      '2. אם לא צוין משך - ברירת מחדל שעתיים.',
      '3. "קפיצה" / "10 דקות" / "מכולת" => is_quick_ride=true, מרגע עכשיו, 10-20 דקות.',
      '4. "ב-8 בערב" = 20:00. "ב-8 בבוקר" = 08:00. שעה קטנה בלי הבהרה כשכבר אחר הצהריים - הנח ערב.',
      '5. אם מדובר בשעה שכבר עברה היום ולא נאמר תאריך - הנח מחר.',
      '6. חציית חצות (23:00 עד 01:00) => end ביום שלמחרת.',
      '7. reason = מטרת הנסיעה בלבד, בלי מילות זמן. מ"מחר מ-16:00 עד 19:00 לחוג" => reason="לחוג".',
      '8. אם חסר מידע קריטי שאי אפשר להסיק => action="clarify" + clarification_question קצרה ומנומסת בעברית.',
      '9. "מי לוקח היום?" / "איפה הרכב?" => action="status".',
      '10. בקשת ביטול => action="cancel".',
      '11. user_name רק אם צוין במפורש שם מהרשימה; אחרת null.'
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        // The schema is what actually keeps markdown out of the payload -
        // asking politely in the prompt is not enough (PRD directive 4).
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
        maxOutputTokens: 512
      }
    });

    const parsed = normalise(safeJsonParse(response.text), heuristic());
    if (!parsed.user_name) parsed.user_name = senderName || null;
    return parsed;
  } catch (err) {
    console.error('[Gemini] Falling back to the local engine:', err.message);
    return heuristic();
  }
}

// Exported for tests.
export const __internals = { heuristicHebrewParser, extractReason, safeJsonParse, normalise };
