import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Moon, Sun, RefreshCw, ChevronDown, LogOut, Lock } from 'lucide-react';
import CarLogo from './CarLogo';
import Sheet from './Sheet';
import { formatTime } from '../utils/datetime';

export default function Header() {
  const {
    currentUser, logout, switchUser, carStatus, settings,
    isDarkMode, toggleDarkMode, refreshData, loading, isAdminUnlocked
  } = useApp();

  const [accountOpen, setAccountOpen] = useState(false);

  const isAvailable = carStatus?.isAvailable;
  const activeRes = carStatus?.activeReservation;

  const iconBtn =
    'w-11 h-11 rounded-full flex items-center justify-center apple-btn-active ' +
    'text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10';

  return (
    <>
      {/* pt-safe matters here: index.html sets viewport-fit=cover and a
          translucent status bar, so without it the logo and title sit under the
          iPhone clock and battery in standalone mode. */}
      <header className="sticky top-0 z-30 glass-panel pt-safe">
        <div className="max-w-2xl mx-auto px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <CarLogo className="w-10 h-10 shrink-0 rounded-[0.875rem] shadow-sm" />
            <div className="min-w-0">
              <h1 className="text-[16px] font-bold text-slate-900 dark:text-white leading-tight truncate">
                רכב משפחתי
              </h1>
              <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-tight truncate">
                {settings?.car_name || carStatus?.carName || 'הרכב של המשפחה'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => refreshData()}
              aria-label="רענון הלו״ז"
              className={iconBtn}
            >
              <RefreshCw
                className={`w-[18px] h-[18px] ${loading ? 'animate-spin text-brand-600 dark:text-brand-400' : ''}`}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={toggleDarkMode}
              aria-label={isDarkMode ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'}
              aria-pressed={isDarkMode}
              className={iconBtn}
            >
              {isDarkMode ? (
                <Sun className="w-[18px] h-[18px] text-amber-400" aria-hidden="true" />
              ) : (
                <Moon className="w-[18px] h-[18px]" aria-hidden="true" />
              )}
            </button>

            {/* The name used to call logout() directly - one stray tap signed you
                out. It now opens a small account sheet instead. */}
            {currentUser && (
              <button
                type="button"
                onClick={() => setAccountOpen(true)}
                aria-label={`החשבון של ${currentUser.name}`}
                className="min-h-[44px] ps-2 pe-2.5 rounded-full flex items-center gap-1.5
                  hover:bg-black/5 dark:hover:bg-white/10 apple-btn-active"
              >
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center
                    text-white font-bold text-[11px] shrink-0"
                  style={{ backgroundColor: currentUser.color || '#0071E3' }}
                  aria-hidden="true"
                >
                  {currentUser.name.slice(0, 2)}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Live status strip. Colour is backed by a dot and a word, so it does
            not rely on colour alone. */}
        <div className="max-w-2xl mx-auto px-4 pb-2">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-semibold border ${
              isAvailable
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25'
                : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/25'
            }`}
            role="status"
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isAvailable ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
              }`}
              aria-hidden="true"
            />
            <span className="truncate">
              {isAvailable
                ? carStatus?.nextReservation
                  ? `פנוי · הבא בתור: ${carStatus.nextReservation.user?.name} ב-${formatTime(carStatus.nextReservation.start_time)}`
                  : 'הרכב פנוי'
                : `אצל ${activeRes?.user?.name} עד ${formatTime(activeRes?.end_time)}`}
            </span>
          </div>
        </div>
      </header>

      {/* Account sheet */}
      <Sheet
        isOpen={accountOpen}
        onClose={() => setAccountOpen(false)}
        title={currentUser?.name}
        subtitle={
          currentUser?.role === 'admin'
            ? isAdminUnlocked
              ? 'הורה · הרשאות ניהול פעילות'
              : 'הורה · נדרש PIN לניהול'
            : 'בן/בת משפחה'
        }
        maxWidth="max-w-sm"
      >
        <div className="space-y-2">
          {currentUser?.role === 'admin' && !isAdminUnlocked && (
            <p className="flex items-start gap-2 p-3 rounded-2xl bg-amber-500/10 text-[13px]
              text-amber-800 dark:text-amber-300 leading-relaxed">
              <Lock className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              כדי לאשר בקשות או לנהל משתמשים, הזינו את קוד ה-PIN בלשונית
              "ניהול והגדרות".
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setAccountOpen(false);
              switchUser();
            }}
            className="w-full min-h-[48px] px-4 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]
              hover:bg-black/[0.07] dark:hover:bg-white/[0.1] text-start
              text-[15px] font-semibold text-slate-800 dark:text-slate-100 apple-btn-active"
          >
            החלפת משתמש
          </button>

          {/* Signing out fully is spatially separated from the routine action. */}
          <button
            type="button"
            onClick={() => {
              setAccountOpen(false);
              logout();
            }}
            className="w-full min-h-[48px] px-4 rounded-2xl bg-rose-500/10 hover:bg-rose-500/[0.16]
              text-rose-600 dark:text-rose-400 text-start text-[15px] font-semibold
              apple-btn-active flex items-center gap-2 mt-4"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            יציאה מלאה (נדרש קוד משפחתי מחדש)
          </button>
        </div>
      </Sheet>
    </>
  );
}
