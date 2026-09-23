import { useState, useCallback } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Header from './components/Header';
import TimelineView from './components/TimelineView';
import BottomTabs from './components/BottomTabs';
import ReservationModal from './components/ReservationModal';
import ReservationDetailsModal from './components/ReservationDetailsModal';
import AdminPanel from './components/AdminPanel';
import OnboardingModal from './components/OnboardingModal';
import { api } from './services/api';
import { AlertCircle, CheckCircle, Info, Loader2 } from 'lucide-react';
import CarLogo from './components/CarLogo';

function MainApp() {
  const {
    familyCodeVerified, currentUser, sessionChecked, toast,
    refreshData, showToast
  } = useApp();

  const [activeTab, setActiveTab] = useState('schedule');
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reservePrefill, setReservePrefill] = useState(null);
  const [selectedReservation, setSelectedReservation] = useState(null);

  const openReservation = useCallback((prefill) => {
    setReservePrefill(prefill && prefill.hour !== undefined ? prefill : null);
    setReserveOpen(true);
  }, []);

  /** Join the waitlist straight from a taken slot in the timeline. */
  const handleRequestWaitlist = useCallback(
    async (reservation) => {
      try {
        const result = await api.joinWaitlist({
          reservationId: reservation.id,
          targetStart: reservation.start_time,
          targetEnd: reservation.end_time
        });
        showToast(
          result.alreadyWaiting
            ? 'אתם כבר ברשימת ההמתנה לזמן הזה'
            : 'נרשמתם לרשימת ההמתנה. נודיע לכם בוואטסאפ 🔔',
          'success'
        );
        await refreshData({ quiet: true });
      } catch (err) {
        showToast(err.message, 'error');
      }
    },
    [refreshData, showToast]
  );

  // Wait for the stored token to be validated before deciding what to show, so
  // a returning user does not see the login screen flash past.
  if (!sessionChecked) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4
        bg-slate-50 dark:bg-black">
        <CarLogo className="w-16 h-16" />
        <Loader2 className="w-5 h-5 animate-spin text-brand-600 dark:text-brand-400" aria-hidden="true" />
        <span className="sr-only">טוען</span>
      </div>
    );
  }

  const ToastIcon =
    toast?.type === 'error' ? AlertCircle : toast?.type === 'success' ? CheckCircle : Info;

  return (
    <div className="min-h-dvh flex flex-col bg-slate-50 dark:bg-black
      text-slate-900 dark:text-slate-100 antialiased">

      {/* Toast. aria-live so it is announced without stealing focus. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed top-0 inset-x-0 z-[60] pt-safe pointer-events-none flex justify-center"
      >
        {toast && (
          <div
            key={toast.id}
            className={`mt-[5.5rem] mx-4 px-4 py-2.5 rounded-2xl glass-card border shadow-xl
              flex items-center gap-2 text-[14px] font-bold max-w-[92vw] animate-pop-in ${
                toast.type === 'error'
                  ? 'text-rose-700 dark:text-rose-300 border-rose-500/30'
                  : toast.type === 'success'
                  ? 'text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                  : 'text-brand-700 dark:text-brand-300 border-brand-600/30'
              }`}
          >
            <ToastIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{toast.message}</span>
          </div>
        )}
      </div>

      {!familyCodeVerified || !currentUser ? (
        <OnboardingModal />
      ) : (
        <>
          <Header />

          <main id="main" className="flex-1 w-full max-w-2xl mx-auto pt-3 px-safe">
            {activeTab === 'schedule' ? (
              <TimelineView
                onOpenNewReservation={openReservation}
                onSelectReservation={setSelectedReservation}
                onRequestWaitlist={handleRequestWaitlist}
              />
            ) : (
              <AdminPanel />
            )}
          </main>

          <BottomTabs
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onOpenNewReservation={openReservation}
          />

          {/* Mounted only while open, so the form cannot carry stale state
              between openings. The previous version kept it mounted for the
              whole session and seeded the date once, which froze the date field
              on whatever day the app was first loaded. */}
          {reserveOpen && (
            <ReservationModal
              prefill={reservePrefill}
              onClose={() => {
                setReserveOpen(false);
                setReservePrefill(null);
              }}
            />
          )}

          <ReservationDetailsModal
            reservation={selectedReservation}
            onClose={() => setSelectedReservation(null)}
          />
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainApp />
    </AppProvider>
  );
}
