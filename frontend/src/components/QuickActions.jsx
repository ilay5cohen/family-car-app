import { useState } from 'react';
import { Zap, CheckCircle2, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import confetti from 'canvas-confetti';
import { formatTime } from '../utils/datetime';

/** The PRD's two one-tap actions: "took it for a few minutes" and "brought it back". */
export default function QuickActions() {
  const { currentUser, carStatus, refreshData, showToast, isAdminUnlocked } = useApp();
  const [busy, setBusy] = useState(null); // 'quick' | 'return'
  const [minutesOpen, setMinutesOpen] = useState(false);

  const isAvailable = carStatus?.isAvailable;
  const activeRes = carStatus?.activeReservation;
  const isMine = activeRes?.user_id === currentUser?.id;
  const canReturn = !isAvailable && (isMine || isAdminUnlocked);

  const celebrate = () => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    confetti({ particleCount: 40, spread: 65, origin: { y: 0.85 }, disableForReducedMotion: true });
  };

  const handleQuickRide = async (minutes) => {
    setMinutesOpen(false);
    setBusy('quick');
    try {
      const result = await api.quickRide(minutes, 'קפיצה קצרה');
      celebrate();
      showToast(`הרכב שלך עד ${formatTime(result.end_time)} 🚗`, 'success');
      await refreshData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleReturn = async () => {
    setBusy('return');
    try {
      const result = await api.returnCar(activeRes?.id);
      celebrate();
      showToast(
        result.waitlistNotified > 0
          ? `תודה! הודענו ל${result.waitlistNames.join(', ')} שהרכב פנוי 🔔`
          : 'תודה שהחזרת את הרכב! 🌟',
        'success'
      );
      await refreshData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-3.5">
      <div className="grid grid-cols-2 gap-2.5">
        {/* Quick ride */}
        <button
          type="button"
          onClick={() => setMinutesOpen((prev) => !prev)}
          disabled={!!busy || !isAvailable}
          aria-expanded={minutesOpen}
          className={`min-h-[56px] px-3 rounded-2xl border text-[14px] font-bold
            flex items-center justify-center gap-2 apple-btn-active ${
              isAvailable
                ? 'bg-brand-600/[0.09] text-brand-700 dark:text-brand-300 border-brand-600/20 hover:bg-brand-600/[0.14]'
                : 'bg-black/[0.03] dark:bg-white/[0.04] text-slate-400 dark:text-slate-500 border-transparent cursor-not-allowed'
            }`}
        >
          {busy === 'quick' ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
          )}
          <span className="text-start leading-tight">
            לקחתי לרגע
            {/* Say WHY it is unavailable instead of just greying out. */}
            {!isAvailable && (
              <span className="block text-[11px] font-medium opacity-80">
                אצל {activeRes?.user?.name}
              </span>
            )}
          </span>
        </button>

        {/* Return */}
        <button
          type="button"
          onClick={handleReturn}
          disabled={!!busy || !canReturn}
          className={`min-h-[56px] px-3 rounded-2xl border text-[14px] font-bold
            flex items-center justify-center gap-2 apple-btn-active ${
              canReturn
                ? 'bg-emerald-500/[0.11] text-emerald-700 dark:text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/[0.18]'
                : 'bg-black/[0.03] dark:bg-white/[0.04] text-slate-400 dark:text-slate-500 border-transparent cursor-not-allowed'
            }`}
        >
          {busy === 'return' ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          )}
          <span className="text-start leading-tight">
            החזרתי את הרכב
            {!isAvailable && !isMine && !isAdminUnlocked && (
              <span className="block text-[11px] font-medium opacity-80">
                רק {activeRes?.user?.name} או הורה
              </span>
            )}
            {isAvailable && (
              <span className="block text-[11px] font-medium opacity-80">הרכב כבר בבית</span>
            )}
          </span>
        </button>
      </div>

      {/* Duration picker - the old button was hardwired to 15 minutes even
          though the PRD asks for 5 or 10 as well. */}
      {minutesOpen && isAvailable && (
        <div className="mt-2 p-2.5 rounded-2xl glass-card animate-pop-in">
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-2 px-1">
            לכמה זמן?
          </p>
          <div className="grid grid-cols-4 gap-2">
            {[5, 10, 15, 30].map((minutes) => (
              <button
                type="button"
                key={minutes}
                onClick={() => handleQuickRide(minutes)}
                className="min-h-[44px] rounded-xl bg-brand-600 hover:bg-brand-700 text-white
                  text-[14px] font-bold apple-btn-active"
              >
                {minutes} דק׳
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
