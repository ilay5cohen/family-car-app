import { Sparkles, AlertTriangle, Flame, Clock } from 'lucide-react';
import { formatTime, spansMidnight } from '../utils/datetime';

/**
 * Shabbat / chag notice.
 *
 * The first version flagged all of Friday and all of Saturday as "driving
 * forbidden", which is wrong in both directions - Friday morning is ordinary
 * driving time, and so is Saturday night after havdalah. It fetched the candle
 * lighting and havdalah times and then used them for decoration only.
 *
 * Now the banner states the actual window, and the override is a real control:
 * it unlocks the hours in that window instead of just changing its own label.
 */
export default function ShabbatBanner({ dayInfo, override, onToggleOverride }) {
  if (!dayInfo?.isDrivingRestricted) return null;

  const { restrictedFrom, restrictedUntil, candleLighting, havdalah, title, isYomTov } = dayInfo;
  const crossesDay = restrictedFrom && restrictedUntil && spansMidnight(restrictedFrom, restrictedUntil);
  const approximate = dayInfo.source !== 'hebcal';

  return (
    <section
      className="rounded-2xl border border-amber-400/30 dark:border-amber-400/20 p-3.5 mb-3.5
        bg-gradient-to-br from-amber-500/[0.09] via-amber-400/[0.12] to-yellow-500/[0.08]"
      aria-label="הודעת שבת וחג"
    >
      <div className="flex items-start gap-2.5">
        <span className="w-9 h-9 rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400
          flex items-center justify-center shrink-0">
          <Sparkles className="w-[18px] h-[18px]" aria-hidden="true" />
        </span>

        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-bold text-amber-900 dark:text-amber-200 leading-tight">
            {title || (isYomTov ? 'יום טוב' : 'שבת קודש')}
          </h3>

          {/* The real boundaries, not a blanket "all day". */}
          {restrictedFrom && restrictedUntil && (
            <p className="text-[13px] text-amber-800/90 dark:text-amber-300/90 mt-1 leading-relaxed">
              <Clock className="w-3.5 h-3.5 inline-block align-[-2px] me-1" aria-hidden="true" />
              נסיעה לא מומלצת בין{' '}
              <strong className="font-bold tabular" dir="ltr">
                {formatTime(restrictedFrom)}
              </strong>{' '}
              ל-
              <strong className="font-bold tabular" dir="ltr">
                {formatTime(restrictedUntil)}
              </strong>
              {crossesDay && ' (למחרת)'}
              {approximate && ' — זמנים משוערים'}
            </p>
          )}

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
            {candleLighting && (
              <span className="text-[12px] text-amber-800/80 dark:text-amber-300/80 inline-flex items-center gap-1">
                <Flame className="w-3 h-3" aria-hidden="true" />
                הדלקת נרות <span className="tabular" dir="ltr">{formatTime(candleLighting)}</span>
              </span>
            )}
            {havdalah && (
              <span className="text-[12px] text-amber-800/80 dark:text-amber-300/80">
                הבדלה <span className="tabular" dir="ltr">{formatTime(havdalah)}</span>
              </span>
            )}
          </div>

          {/* Outside those hours the day is simply usable - say so, so nobody
              thinks the whole day is blocked. */}
          <p className="text-[12px] text-amber-700/70 dark:text-amber-400/70 mt-1.5">
            שאר שעות היום פתוחות לשריון כרגיל.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onToggleOverride(!override)}
          aria-pressed={override}
          className={`shrink-0 min-h-[44px] px-3.5 rounded-xl text-[13px] font-bold border apple-btn-active ${
            override
              ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
              : 'bg-white/70 dark:bg-neutral-800/70 text-amber-900 dark:text-amber-200 border-amber-400/40'
          }`}
        >
          {override ? 'עקיפה פעילה' : 'בכל זאת'}
        </button>
      </div>

      {override && (
        <p className="mt-2.5 pt-2 border-t border-amber-400/25 text-[12px]
          text-amber-800 dark:text-amber-300 flex items-start gap-1.5 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-px" aria-hidden="true" />
          <span>
            מצב עקיפה פעיל — ניתן לשריין גם בשעות שבת/חג. השריון עצמו עדיין
            יבקש אישור נוסף לפני השמירה.
          </span>
        </p>
      )}
    </section>
  );
}
