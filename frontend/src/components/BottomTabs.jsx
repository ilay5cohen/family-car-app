import { CalendarDays, Plus, Settings } from 'lucide-react';
import { useApp } from '../context/AppContext';

/**
 * iOS-style bottom tab bar: two destinations plus the prominent centre action
 * (PRD section 3).
 *
 * pb-safe-nav is the fix that matters on hardware: index.html sets
 * viewport-fit=cover, so with a plain pb-4 the bar sat underneath the iPhone
 * home indicator and the centre '+' was partly unreachable.
 */
export default function BottomTabs({ activeTab, setActiveTab, onOpenNewReservation }) {
  const { currentUser, isAdminUnlocked, carStatus } = useApp();

  const pendingCount = carStatus?.pendingCount || 0;
  const needsPin = currentUser?.role === 'admin' && !isAdminUnlocked;
  const showSettingsBadge = (isAdminUnlocked && pendingCount > 0) || needsPin;

  const tabClass = (isActive) =>
    `flex-1 min-h-[52px] flex flex-col items-center justify-center gap-0.5 rounded-2xl apple-btn-active ${
      isActive
        ? 'text-brand-600 dark:text-brand-400'
        : 'text-slate-500 dark:text-slate-400'
    }`;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 pt-2 pb-safe-nav px-safe pointer-events-none"
      aria-label="ניווט ראשי"
    >
      <div className="max-w-md mx-auto pointer-events-auto">
        <div className="glass-panel rounded-[1.75rem] border border-black/[0.07] dark:border-white/10
          shadow-xl shadow-black/10 dark:shadow-black/50 px-2 flex items-center gap-1">

          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            aria-current={activeTab === 'schedule' ? 'page' : undefined}
            className={tabClass(activeTab === 'schedule')}
          >
            <span className={`p-1 rounded-xl ${activeTab === 'schedule' ? 'bg-brand-600/12' : ''}`}>
              <CalendarDays className="w-[22px] h-[22px]" aria-hidden="true" />
            </span>
            {/* Icon plus label, never icon alone */}
            <span className="text-[11px] font-semibold tracking-tight">לוח זמנים</span>
          </button>

          {/* Centre action, raised the way iOS does it */}
          <div className="relative w-16 flex justify-center">
            <button
              type="button"
              onClick={() => onOpenNewReservation()}
              aria-label="שריון חדש"
              className="absolute -top-7 w-[58px] h-[58px] rounded-full
                bg-gradient-to-br from-brand-500 to-brand-700 text-white
                shadow-xl shadow-brand-600/35 flex items-center justify-center
                apple-btn-active border-[3px] border-white dark:border-ink-850"
            >
              <Plus className="w-7 h-7" strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            aria-current={activeTab === 'settings' ? 'page' : undefined}
            className={tabClass(activeTab === 'settings')}
          >
            <span className={`relative p-1 rounded-xl ${activeTab === 'settings' ? 'bg-brand-600/12' : ''}`}>
              <Settings className="w-[22px] h-[22px]" aria-hidden="true" />
              {showSettingsBadge && (
                <span
                  className="absolute -top-0.5 -end-0.5 min-w-[18px] h-[18px] px-1 rounded-full
                    bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center
                    ring-2 ring-white dark:ring-ink-850"
                >
                  {isAdminUnlocked && pendingCount > 0 ? pendingCount : '!'}
                </span>
              )}
            </span>
            <span className="text-[11px] font-semibold tracking-tight">ניהול</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
