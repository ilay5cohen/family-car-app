import { AlertTriangle } from 'lucide-react';
import Sheet from './Sheet';

/**
 * Replaces window.confirm() for destructive actions.
 * The native dialog works, but it looks like a browser alert in the middle of an
 * app that is meant to feel like an iOS app - and it is blocked outright in some
 * embedded web views, which would have made deletion silently impossible there.
 */
export default function ConfirmDialog({
  isOpen,
  onCancel,
  onConfirm,
  title,
  message,
  confirmLabel = 'אישור',
  cancelLabel = 'ביטול',
  destructive = true,
  loading = false
}) {
  return (
    <Sheet isOpen={isOpen} onClose={onCancel} maxWidth="max-w-sm" closeLabel={cancelLabel}>
      <div className="text-center pt-2 pb-1">
        <div
          className={`w-14 h-14 rounded-3xl flex items-center justify-center mx-auto mb-4 ${
            destructive
              ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
              : 'bg-brand-600/12 text-brand-600 dark:text-brand-400'
          }`}
        >
          <AlertTriangle className="w-7 h-7" aria-hidden="true" />
        </div>

        <h2 className="text-[17px] font-bold text-slate-900 dark:text-white mb-1.5">{title}</h2>
        <p className="text-[14px] leading-relaxed text-slate-600 dark:text-slate-400 mb-5 max-w-[17rem] mx-auto">
          {message}
        </p>

        {/* Cancel first in the DOM so it takes focus: the safe choice is the
            default, and a stray Enter cannot delete anything. */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onCancel}
            data-autofocus
            className="w-full min-h-[44px] rounded-2xl bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15
              text-slate-800 dark:text-slate-100 font-semibold text-[15px] apple-btn-active"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`w-full min-h-[44px] rounded-2xl font-bold text-[15px] text-white apple-btn-active
              disabled:opacity-60 shadow-sm ${
                destructive
                  ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/25'
                  : 'bg-brand-600 hover:bg-brand-700 shadow-brand-600/25'
              }`}
          >
            {loading ? 'רגע...' : confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
