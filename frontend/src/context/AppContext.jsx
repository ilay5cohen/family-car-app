import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api, setAuthToken, setUnauthorizedHandler, getAuthToken } from '../services/api';
import { todayKey, tzOffsetMinutes } from '../utils/datetime';

const AppContext = createContext(null);

const POLL_INTERVAL_MS = 20000;

export function AppProvider({ children }) {
  // ----------------------------------------------------
  // Session
  // The server is the authority now. localStorage only caches the token and the
  // display copy of the user; setting a flag by hand no longer grants access,
  // because every request is checked server-side.
  // ----------------------------------------------------
  const [session, setSession] = useState({
    familyVerified: false,
    user: null,
    isAdminUnlocked: false
  });
  const [sessionChecked, setSessionChecked] = useState(false);

  // ----------------------------------------------------
  // Data
  // ----------------------------------------------------
  const [users, setUsers] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => todayKey());
  const [reservations, setReservations] = useState([]);
  const [carStatus, setCarStatus] = useState({ isAvailable: true });
  const [dayInfo, setDayInfo] = useState(null);
  const [myWaitlist, setMyWaitlist] = useState([]);
  const [settings, setSettings] = useState(null);

  const [loading, setLoading] = useState(false);
  // Distinguishes "nothing booked" from "we have not loaded yet", so the
  // timeline stops flashing "the car is completely free!" during every load.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState(null);

  const toastTimer = useRef(null);
  const requestId = useRef(0);

  // ----------------------------------------------------
  // Theme
  // ----------------------------------------------------
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('car_app_dark_mode');
      if (saved !== null) return saved === 'true';
    } catch {
      /* storage blocked */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDarkMode);
    // Keep the iOS status bar and browser chrome in step with the theme.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isDarkMode ? '#000000' : '#f8fafc');
    try {
      localStorage.setItem('car_app_dark_mode', String(isDarkMode));
    } catch {
      /* storage blocked */
    }
  }, [isDarkMode]);

  const toggleDarkMode = useCallback(() => setIsDarkMode((prev) => !prev), []);

  // ----------------------------------------------------
  // Toast
  // ----------------------------------------------------
  const showToast = useCallback((message, type = 'info') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 5000 : 3500);
  }, []);

  useEffect(() => () => toastTimer.current && clearTimeout(toastTimer.current), []);

  // ----------------------------------------------------
  // Session bootstrap: ask the server whether our stored token is still good.
  // ----------------------------------------------------
  const resetSession = useCallback(() => {
    setAuthToken(null);
    setSession({ familyVerified: false, user: null, isAdminUnlocked: false });
    setUsers([]);
    setReservations([]);
    setCarStatus({ isAvailable: true });
    setHasLoadedOnce(false);
    try {
      localStorage.removeItem('car_app_user');
    } catch {
      /* storage blocked */
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      resetSession();
      showToast('פג תוקף ההתחברות. אנא היכנס מחדש', 'error');
    });
  }, [resetSession, showToast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getAuthToken()) {
        setSessionChecked(true);
        return;
      }
      try {
        const me = await api.me();
        if (cancelled) return;
        setSession({
          familyVerified: !!me.familyVerified,
          user: me.user || null,
          isAdminUnlocked: !!me.isAdminUnlocked
        });
      } catch {
        if (!cancelled) resetSession();
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resetSession]);

  // ----------------------------------------------------
  // Loaders
  // ----------------------------------------------------
  const loadUsers = useCallback(async () => {
    try {
      setUsers(await api.getUsers());
    } catch (err) {
      // On the login screen this is the only signal that the server is down.
      setLoadError(err.message);
    }
  }, []);

  // The user list is needed to render the login screen, so load it as soon as
  // the family code is accepted.
  useEffect(() => {
    if (session.familyVerified) loadUsers();
  }, [session.familyVerified, loadUsers]);

  const refreshData = useCallback(
    async ({ quiet = false } = {}) => {
      if (!session.familyVerified || !session.user) return;

      const id = ++requestId.current;
      if (!quiet) setLoading(true);
      try {
        const [statusRes, resList, dayStatus, waitlist] = await Promise.all([
          api.getCarStatus(),
          api.getReservations({ date: selectedDate, tzOffsetMinutes: tzOffsetMinutes() }),
          api.getDayStatus(selectedDate),
          api.getWaitlist().catch(() => [])
        ]);

        // A slower earlier request must not overwrite a newer result.
        if (id !== requestId.current) return;

        setCarStatus(statusRes);
        setReservations(resList);
        setDayInfo(dayStatus);
        setMyWaitlist(waitlist);
        setLoadError(null);
      } catch (err) {
        if (id !== requestId.current) return;
        setLoadError(err.message);
        if (!quiet) showToast(err.message, 'error');
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setHasLoadedOnce(true);
        }
      }
    },
    [session.familyVerified, session.user, selectedDate, showToast]
  );

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await api.getSettings());
    } catch {
      /* non-fatal: the header falls back to defaults */
    }
  }, []);

  useEffect(() => {
    if (session.familyVerified && session.user) loadSettings();
  }, [session.familyVerified, session.user, loadSettings]);

  // ----------------------------------------------------
  // Polling - paused while the tab is hidden.
  // The old version polled every 20s for ever, draining battery on a phone
  // sitting in a pocket with the PWA open.
  // ----------------------------------------------------
  useEffect(() => {
    if (!session.familyVerified || !session.user) return undefined;

    refreshData();

    let timer = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => refreshData({ quiet: true }), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Catch up immediately on return, then resume the interval.
        refreshData({ quiet: true });
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [session.familyVerified, session.user, refreshData]);

  // ----------------------------------------------------
  // Auth actions
  // ----------------------------------------------------
  const loginFamily = useCallback(async (code) => {
    const result = await api.verifyFamilyCode(code);
    setSession((prev) => ({ ...prev, familyVerified: true }));
    return result;
  }, []);

  const selectUser = useCallback(async (user) => {
    const result = await api.selectUser(user.id);
    setSession((prev) => ({
      ...prev,
      user: result.user,
      isAdminUnlocked: false
    }));
    return result;
  }, []);

  const verifyAdminPin = useCallback(async (userId, pin) => {
    const result = await api.verifyAdminPin(userId, pin);
    setSession((prev) => ({
      ...prev,
      user: result.user,
      isAdminUnlocked: true
    }));
    return result;
  }, []);

  const logout = useCallback(() => {
    resetSession();
  }, [resetSession]);

  const switchUser = useCallback(() => {
    // Keep the family code verified; only drop the identity.
    setSession((prev) => ({ ...prev, user: null, isAdminUnlocked: false }));
  }, []);

  const value = {
    // session
    familyCodeVerified: session.familyVerified,
    currentUser: session.user,
    isAdminUnlocked: session.isAdminUnlocked,
    sessionChecked,
    loginFamily,
    selectUser,
    verifyAdminPin,
    logout,
    switchUser,

    // data
    users,
    loadUsers,
    selectedDate,
    setSelectedDate,
    reservations,
    carStatus,
    dayInfo,
    myWaitlist,
    settings,
    loadSettings,
    refreshData,

    // ui state
    loading,
    hasLoadedOnce,
    loadError,
    isDarkMode,
    toggleDarkMode,
    toast,
    showToast
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
