/**
 * API client for the Family Car app.
 *
 * Two things every call now does that the first version did not:
 *  - sends the session token, because the server actually enforces auth
 *  - throws a real Error on a non-2xx response, so callers cannot mistake an
 *    error body for a success (the old code returned res.json() unchecked, so
 *    a 403 looked like a successful result and the UI showed "saved!")
 */

const API_BASE = (import.meta.env && import.meta.env.VITE_API_URL) ? import.meta.env.VITE_API_URL : '/api';
const TOKEN_KEY = 'car_app_token';

let authToken = null;
try {
  authToken = localStorage.getItem(TOKEN_KEY);
} catch {
  // Private mode or blocked storage: the session simply will not persist.
}

/** Called when the server says the session is gone, so the app can log out. */
let onUnauthorized = null;

export function setAuthToken(token) {
  authToken = token || null;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* non-persistent session */
  }
}

export function getAuthToken() {
  return authToken;
}

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

class ApiError extends Error {
  constructor(message, { status, details, conflict } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details || null;
    this.conflict = !!conflict;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // No response at all: the server is down or the device is offline.
    throw new ApiError('אין חיבור לשרת. בדוק את האינטרנט ונסה שוב', { status: 0 });
  }

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    // A 401 normally means the session expired, so the app logs out. But the
    // login endpoints answer 401 for "wrong code" / "wrong PIN" too, and
    // treating that as an expiry threw the user back to the family-code screen
    // on every mistyped PIN - losing the session they had legitimately earned.
    const isLoginAttempt = path.startsWith('/auth/verify') || path.startsWith('/auth/select');
    if (response.status === 401 && !isLoginAttempt) {
      setAuthToken(null);
      onUnauthorized?.();
    }
    throw new ApiError(payload?.error || `שגיאת שרת (${response.status})`, {
      status: response.status,
      details: payload?.details,
      conflict: payload?.conflict || response.status === 409
    });
  }

  return payload;
}

export { ApiError };

export const api = {
  // ----------------------------------------------------
  // Auth
  // ----------------------------------------------------
  async verifyFamilyCode(code) {
    const result = await request('/auth/verify-code', { method: 'POST', body: { code } });
    if (result?.token) setAuthToken(result.token);
    return result;
  },

  async selectUser(userId) {
    const result = await request('/auth/select-user', { method: 'POST', body: { userId } });
    if (result?.token) setAuthToken(result.token);
    return result;
  },

  async verifyAdminPin(userId, pin) {
    const result = await request('/auth/verify-pin', { method: 'POST', body: { userId, pin } });
    if (result?.token) setAuthToken(result.token);
    return result;
  },

  me() {
    return request('/auth/me');
  },

  // ----------------------------------------------------
  // Status, users
  // ----------------------------------------------------
  getCarStatus() {
    return request('/status');
  },

  getUsers() {
    return request('/users');
  },

  createUser(userData) {
    return request('/users', { method: 'POST', body: userData });
  },

  updateUser(id, updates) {
    return request(`/users/${id}`, { method: 'PUT', body: updates });
  },

  deleteUser(id) {
    return request(`/users/${id}`, { method: 'DELETE' });
  },

  // ----------------------------------------------------
  // Reservations
  // ----------------------------------------------------
  getReservations(params = {}) {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    return request(`/reservations${query ? `?${query}` : ''}`);
  },

  getPendingApprovals() {
    return request('/reservations/pending');
  },

  createReservation(data) {
    return request('/reservations', { method: 'POST', body: data });
  },

  quickRide(minutes = 15, reason = 'קפיצה קצרה') {
    return request('/reservations/quick', { method: 'POST', body: { minutes, reason } });
  },

  returnCar(reservationId = null) {
    return request('/reservations/return', { method: 'POST', body: { reservationId } });
  },

  approveReservation(id) {
    return request(`/reservations/${id}/approve`, { method: 'PUT' });
  },

  rejectReservation(id, reason) {
    return request(`/reservations/${id}/reject`, { method: 'PUT', body: { reason } });
  },

  deleteReservation(id, reason) {
    return request(`/reservations/${id}`, { method: 'DELETE', body: reason ? { reason } : undefined });
  },

  // ----------------------------------------------------
  // Waitlist
  // ----------------------------------------------------
  getWaitlist() {
    return request('/waitlist');
  },

  joinWaitlist(data) {
    return request('/waitlist', { method: 'POST', body: data });
  },

  leaveWaitlist(id) {
    return request(`/waitlist/${id}`, { method: 'DELETE' });
  },

  // ----------------------------------------------------
  // Calendar
  // ----------------------------------------------------
  getDayStatus(dateStr) {
    return request(`/calendar/day-status?date=${encodeURIComponent(dateStr)}`);
  },

  // ----------------------------------------------------
  // Settings
  // ----------------------------------------------------
  getSettings() {
    return request('/settings');
  },

  updateSettings(settings) {
    return request('/settings', { method: 'PUT', body: settings });
  },

  changePin(currentPin, newPin) {
    return request('/settings/pin', { method: 'PUT', body: { currentPin, newPin } });
  },

  // ----------------------------------------------------
  // WhatsApp
  // ----------------------------------------------------
  getWhatsAppStatus() {
    return request('/whatsapp/status');
  },

  connectWhatsApp() {
    return request('/whatsapp/connect', { method: 'POST' });
  },

  disconnectWhatsApp() {
    return request('/whatsapp/disconnect', { method: 'POST' });
  },

  simulateWhatsAppMessage(text, asUserId) {
    return request('/whatsapp/simulate', { method: 'POST', body: { text, asUserId } });
  },

  sendTestDigest() {
    return request('/whatsapp/test-digest', { method: 'POST' });
  }
};
