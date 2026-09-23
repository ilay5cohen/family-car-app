import { useEffect, useRef, useCallback, useId } from 'react';
import { X } from 'lucide-react';

/**
 * The shared modal / bottom-sheet shell.
 *
 * Every modal in the first version was a bare fixed div, which meant none of
 * them could be closed with Escape or by tapping the backdrop, none trapped
 * focus, none announced themselves to a screen reader, and the page behind kept
 * scrolling on iOS. Centralising it means a modal cannot be added without them.
 */
export default function Sheet({
  isOpen,
  onClose,
  title,
  subtitle,
  icon: Icon,
  accentColor,
  children,
  footer,
  maxWidth = 'max-w-lg',
  closeLabel = 'סגור'
}) {
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);
  const titleId = useId();

  // Escape to dismiss, and a focus trap so Tab cannot wander behind the sheet.
  const onKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = panelRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return undefined;

    previouslyFocused.current = document.activeElement;

    // Lock the page behind the sheet. position: fixed rather than
    // overflow: hidden, because iOS Safari ignores the latter on <body>.
    const { body } = document;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    // Move focus into the sheet so a keyboard or screen reader user lands here.
    const timer = setTimeout(() => {
      const target =
        panelRef.current?.querySelector('[data-autofocus]') ||
        panelRef.current?.querySelector(
          'input:not([type="hidden"]):not([disabled]), button:not([disabled])'
        );
      target?.focus();
    }, 60);

    return () => {
      clearTimeout(timer);
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
      // Return focus to whatever opened the sheet.
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in"
      onKeyDown={onKeyDown}
    >
      {/* Backdrop. The blur is the dismissal affordance: it says the layer
          behind is inert and tappable to close. */}
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm cursor-default"
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        dir="rtl"
        className={`relative w-full ${maxWidth} glass-sheet border-t sm:border border-black/5 dark:border-white/10
          rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-2xl
          max-h-[92dvh] sm:max-h-[88dvh] flex flex-col
          animate-sheet-up sm:animate-pop-in`}
      >
        {/* Grab handle - the iOS signal that a sheet can be dragged/dismissed */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
          <span className="w-9 h-1.5 rounded-full bg-slate-300 dark:bg-neutral-600" />
        </div>

        {title && (
          <div className="flex items-start justify-between gap-3 px-5 pt-3 sm:pt-5 pb-4 border-b border-black/5 dark:border-white/10 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              {Icon && (
                <span
                  className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0"
                  style={
                    accentColor
                      ? { backgroundColor: `${accentColor}1f`, color: accentColor }
                      : undefined
                  }
                >
                  <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="text-[17px] font-bold text-slate-900 dark:text-white truncate leading-tight"
                >
                  {title}
                </h2>
                {subtitle && (
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>

            {/* 44x44 hit area, as required for a primary control */}
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="w-11 h-11 -mt-1.5 -me-2.5 shrink-0 rounded-full flex items-center justify-center
                text-slate-400 hover:text-slate-700 dark:hover:text-slate-200
                hover:bg-black/5 dark:hover:bg-white/10 apple-btn-active"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="overflow-y-auto overscroll-contain px-5 py-4 flex-1">{children}</div>

        {footer && (
          <div className="px-5 pt-3 pb-4 pb-safe border-t border-black/5 dark:border-white/10 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
