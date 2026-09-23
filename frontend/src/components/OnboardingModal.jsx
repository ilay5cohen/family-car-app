import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ArrowRight, Lock, ShieldCheck, WifiOff, Loader2 } from 'lucide-react';
import CarLogo from './CarLogo';

/**
 * Three-step entry: family code -> who are you -> parent PIN.
 *
 * The important change from the first version: there is no way past the PIN.
 * It used to offer "continue without a PIN (regular user)", which signed you in
 * as אבא - and because the rest of the app checked `role === 'admin'` rather
 * than "did they actually enter the PIN", that granted full override powers.
 */
export default function OnboardingModal() {
  const {
    familyCodeVerified,
    loginFamily,
    currentUser,
    selectUser,
    verifyAdminPin,
    users,
    loadUsers,
    loadError,
    showToast
  } = useApp();

  const [step, setStep] = useState(familyCodeVerified ? 'select_user' : 'family_code');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [pendingAdmin, setPendingAdmin] = useState(null);
  const [pin, setPin] = useState('');

  useEffect(() => {
    setStep(familyCodeVerified ? 'select_user' : 'family_code');
  }, [familyCodeVerified]);

  if (familyCodeVerified && currentUser) return null;

  const handleVerifyCode = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await loginFamily(code.trim());
    } catch (err) {
      setError(err.message || 'קוד משפחתי שגוי');
    } finally {
      setBusy(false);
    }
  };

  const handleSelectUser = async (user) => {
    setError('');
    if (user.role === 'admin') {
      setPendingAdmin(user);
      setPin('');
      setStep('admin_pin');
      return;
    }
    setBusy(true);
    try {
      await selectUser(user);
      showToast(`שלום ${user.name}! 🚗`, 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyPin = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await verifyAdminPin(pendingAdmin.id, pin.trim());
      showToast(`שלום ${pendingAdmin.name}! פאנל הניהול פתוח 🌟`, 'success');
    } catch (err) {
      setError(err.message || 'קוד PIN שגוי');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'w-full min-h-[52px] px-4 rounded-2xl text-center text-[19px] font-bold tracking-[0.3em] ' +
    'bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 ' +
    'text-slate-900 dark:text-white placeholder:tracking-normal placeholder:font-medium ' +
    'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent';

  const primaryBtn =
    'w-full min-h-[50px] rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-[16px] ' +
    'shadow-lg shadow-brand-600/25 apple-btn-active disabled:opacity-50 disabled:shadow-none ' +
    'flex items-center justify-center gap-2';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-safe pb-safe
        bg-gradient-to-b from-slate-100 via-slate-50 to-brand-50
        dark:from-black dark:via-ink-900 dark:to-brand-900/25"
      dir="rtl"
    >
      <div className="w-full max-w-sm glass-card rounded-[1.75rem] p-6 sm:p-7 text-center animate-pop-in">
        <CarLogo className="w-16 h-16 mx-auto mb-4" />

        {/* ---------------- Step 1: family code ---------------- */}
        {step === 'family_code' && (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div>
              <h1 className="text-[22px] font-bold text-slate-900 dark:text-white leading-tight">
                רכב משפחתי
              </h1>
              <p className="text-[14px] text-slate-500 dark:text-slate-400 mt-1.5">
                הזינו את הקוד המשפחתי כדי להיכנס
              </p>
            </div>

            <div className="text-start">
              <label htmlFor="family-code" className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                קוד משפחתי
              </label>
              <input
                id="family-code"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 12))}
                required
                data-autofocus
                aria-describedby={error ? 'code-error' : undefined}
                aria-invalid={!!error}
                className={inputClass}
              />
            </div>

            {/* The default code is no longer printed on screen. */}
            {error && (
              <p id="code-error" role="alert" className="text-[13px] text-rose-600 dark:text-rose-400 font-semibold">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy || code.length < 4} className={primaryBtn}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              <span>{busy ? 'מאמת...' : 'כניסה'}</span>
            </button>
          </form>
        )}

        {/* ---------------- Step 2: who are you ---------------- */}
        {step === 'select_user' && (
          <div>
            <h1 className="text-[20px] font-bold text-slate-900 dark:text-white leading-tight">
              מי אתם במשפחה?
            </h1>
            <p className="text-[14px] text-slate-500 dark:text-slate-400 mt-1.5 mb-5">
              בחרו את השם שלכם כדי לשייך את השריונים
            </p>

            {/* The list arrives asynchronously. Without these two states the
                screen was simply blank and offered no explanation. */}
            {loadError && users.length === 0 && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-start">
                <div className="flex items-center gap-2 mb-1.5">
                  <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
                  <span className="text-[14px] font-bold text-amber-800 dark:text-amber-300">
                    אין חיבור לשרת
                  </span>
                </div>
                <p className="text-[13px] text-amber-800/80 dark:text-amber-300/80 leading-relaxed mb-3">
                  {loadError}
                </p>
                <button
                  type="button"
                  onClick={loadUsers}
                  className="min-h-[44px] w-full rounded-xl bg-amber-600 text-white text-[14px] font-bold apple-btn-active"
                >
                  נסו שוב
                </button>
              </div>
            )}

            {!loadError && users.length === 0 && (
              <div className="grid grid-cols-2 gap-2.5" aria-busy="true" aria-label="טוען את רשימת המשפחה">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="p-3 rounded-2xl border border-black/5 dark:border-white/10">
                    <div className="skeleton w-11 h-11 rounded-2xl mx-auto mb-2" />
                    <div className="skeleton h-3 w-14 rounded-full mx-auto" />
                  </div>
                ))}
              </div>
            )}

            {users.length > 0 && (
              <div className="grid grid-cols-2 gap-2.5 max-h-[16rem] overflow-y-auto p-0.5">
                {users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleSelectUser(user)}
                    disabled={busy}
                    className="min-h-[92px] p-3 rounded-2xl glass-card border border-black/5 dark:border-white/10
                      hover:border-brand-500/60 flex flex-col items-center justify-center gap-1.5
                      apple-btn-active disabled:opacity-50"
                  >
                    <span
                      className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold text-[15px] shadow-sm"
                      style={{ backgroundColor: user.color || '#0071E3' }}
                      aria-hidden="true"
                    >
                      {user.name.slice(0, 2)}
                    </span>
                    <span className="text-[14px] font-bold text-slate-800 dark:text-slate-100">
                      {user.name}
                    </span>
                    {user.role === 'admin' && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full
                        bg-brand-600/10 text-brand-700 dark:text-brand-300 font-semibold">
                        <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                        הורה
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-400 font-semibold mt-3">
                {error}
              </p>
            )}
          </div>
        )}

        {/* ---------------- Step 3: parent PIN (no way around it) ---------------- */}
        {step === 'admin_pin' && pendingAdmin && (
          <div>
            <div className="flex justify-start mb-1">
              <button
                type="button"
                onClick={() => {
                  setStep('select_user');
                  setError('');
                }}
                className="min-h-[44px] -ms-2 px-2 text-[14px] text-brand-600 dark:text-brand-400
                  font-semibold flex items-center gap-1 apple-btn-active rounded-xl"
              >
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
                <span>חזרה</span>
              </button>
            </div>

            <span
              className="w-14 h-14 rounded-3xl flex items-center justify-center text-white font-bold text-[17px]
                shadow-sm mx-auto mb-3"
              style={{ backgroundColor: pendingAdmin.color || '#0071E3' }}
              aria-hidden="true"
            >
              {pendingAdmin.name.slice(0, 2)}
            </span>

            <h1 className="text-[19px] font-bold text-slate-900 dark:text-white leading-tight">
              אימות הורה: {pendingAdmin.name}
            </h1>
            <p className="text-[14px] text-slate-500 dark:text-slate-400 mt-1.5 mb-5">
              הזינו קוד PIN בן 4 ספרות
            </p>

            <form onSubmit={handleVerifyPin} className="space-y-4">
              <div>
                <label htmlFor="admin-pin" className="sr-only">
                  קוד PIN של {pendingAdmin.name}
                </label>
                <input
                  id="admin-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="••••"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  required
                  data-autofocus
                  aria-invalid={!!error}
                  aria-describedby={error ? 'pin-error' : undefined}
                  className={`${inputClass} w-40 mx-auto`}
                />
              </div>

              {error && (
                <p id="pin-error" role="alert" className="text-[13px] text-rose-600 dark:text-rose-400 font-semibold">
                  {error}
                </p>
              )}

              <button type="submit" disabled={busy || pin.length < 4} className={primaryBtn}>
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                )}
                <span>{busy ? 'מאמת...' : 'אישור וכניסה'}</span>
              </button>

              <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-relaxed">
                כניסה כהורה דורשת קוד PIN. אם שכחתם אותו, ההורה השני יכול לאפס
                אותו בהגדרות.
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
