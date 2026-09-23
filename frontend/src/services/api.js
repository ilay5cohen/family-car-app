/**
 * API client for the Family Car app.
 *
 * Supports both:
 *  - Real Node.js backend when running locally or configured via VITE_API_URL
 *  - Client-side mockStorage fallback for static hosting (e.g., GitHub Pages)
 */

import { mockStorage } from './mockStorage';

const isGitHubPages =
  typeof window !== 'undefined' &&
  (window.location.hostname.includes('github.io') || window.location.hostname.includes('netlify.app'));

const hasExplicitBackend = !!(import.meta.env && import.meta.env.VITE_API_URL);
const API_BASE = hasExplicitBackend ? import.meta.env.VITE_API_URL : '/api';
const TOKEN_KEY = 'car_app_token';

// Use local mock storage if on GitHub Pages without an explicit backend
let useLocalFallback = isGitHubPages && !hasExplicitBackend;

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
  if (useLocalFallback) {
    throw new ApiError('USING_LOCAL_FALLBACK', { status: 0 });
  }

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
    useLocalFallback = true;
    throw new ApiError('USING_LOCAL_FALLBACK', { status: 0 });
  }

  if (response.status === 404 && !hasExplicitBackend) {
    useLocalFallback = true;
    throw new ApiError('USING_LOCAL_FALLBACK', { status: 404 });
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
    try {
      const result = await request('/auth/verify-code', { method: 'POST', body: { code } });
      if (result?.token) setAuthToken(result.token);
      return result;
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        const res = mockStorage.verifyFamilyCode(code);
        setAuthToken(res.token);
        return res;
      }
      throw err;
    }
  },

  async selectUser(userId) {
    try {
      const result = await request('/auth/select-user', { method: 'POST', body: { userId } });
      if (result?.token) setAuthToken(result.token);
      return result;
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        const res = mockStorage.selectUser(userId);
        setAuthToken(res.token);
        return res;
      }
      throw err;
    }
  },

  async verifyAdminPin(userId, pin) {
    try {
      const result = await request('/auth/verify-pin', { method: 'POST', body: { userId, pin } });
      if (result?.token) setAuthToken(result.token);
      return result;
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        const res = mockStorage.verifyAdminPin(userId, pin);
        setAuthToken(res.token);
        return res;
      }
      throw err;
    }
  },

  async me() {
    try {
      return await request('/auth/me');
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.me();
      }
      throw err;
    }
  },

  // ----------------------------------------------------
  // Status, users
  // ----------------------------------------------------
  async getCarStatus() {
    try {
      return await request('/status');
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.getCarStatus();
      }
      throw err;
    }
  },

  async getUsers() {
    try {
      return await request('/users');
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.getUsers();
      }
      throw err;
    }
  },

  async createUser(userData) {
    try {
      return await request('/users', { method: 'POST', body: userData });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.createUser(userData);
      }
      throw err;
    }
  },

  async updateUser(id, updates) {
    try {
      return await request(`/users/${id}`, { method: 'PUT', body: updates });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.updateUser(id, updates);
      }
      throw err;
    }
  },

  async deleteUser(id) {
    try {
      return await request(`/users/${id}`, { method: 'DELETE' });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.deleteUser(id);
      }
      throw err;
    }
  },

  // ----------------------------------------------------
  // Reservations
  // ----------------------------------------------------
  async getReservations(params = {}) {
    try {
      const query = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      ).toString();
      return await request(`/reservations${query ? `?${query}` : ''}`);
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.getReservations(params);
      }
      throw err;
    }
  },

  async getPendingApprovals() {
    try {
      return await request('/reservations/pending');
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.getPendingApprovals();
      }
      throw err;
    }
  },

  async createReservation(data) {
    try {
      return await request('/reservations', { method: 'POST', body: data });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.createReservation(data);
      }
      throw err;
    }
  },

  async quickRide(minutes = 15, reason = 'קפיצה קצרה') {
    try {
      return await request('/reservations/quick', { method: 'POST', body: { minutes, reason } });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.quickRide(minutes, reason);
      }
      throw err;
    }
  },

  async returnCar(reservationId = null) {
    try {
      return await request('/reservations/return', { method: 'POST', body: { reservationId } });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.returnCar(reservationId);
      }
      throw err;
    }
  },

  async approveReservation(id) {
    try {
      return await request(`/reservations/${id}/approve`, { method: 'PUT' });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.approveReservation(id);
      }
      throw err;
    }
  },

  async rejectReservation(id, reason) {
    try {
      return await request(`/reservations/${id}/reject`, { method: 'PUT', body: { reason } });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.rejectReservation(id, reason);
      }
      throw err;
    }
  },

  async deleteReservation(id, reason) {
    try {
      return await request(`/reservations/${id}`, { method: 'DELETE', body: reason ? { reason } : undefined });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.deleteReservation(id, reason);
      }
      throw err;
    }
  },

  // ----------------------------------------------------
  // Waitlist
  // ----------------------------------------------------
  async getWaitlist() {
    try {
      return await request('/waitlist');
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.getWaitlist();
      }
      throw err;
    }
  },

  async joinWaitlist(data) {
    try {
      return await request('/waitlist', { method: 'POST', body: data });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.joinWaitlist(data);
      }
      throw err;
    }
  },

  async leaveWaitlist(id) {
    try {
      return await request(`/waitlist/${id}`, { method: 'DELETE' });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.leaveWaitlist(id);
      }
      throw err;
    }
  },

  // ----------------------------------------------------
  // Calendar
  // ----------------------------------------------------
  async getDayStatus(dateStr) {
    try {
      return await request(`/calendar/day-status?date=${encodeURIComponent(dateStr)}`);
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.getDayStatus(dateStr);
      }
      throw err;
    }
  },

  // ----------------------------------------------------
  // Settings
  // ----------------------------------------------------
  async getSettings() {
    try {
      return await request('/settings');
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.getSettings();
      }
      throw err;
    }
  },

  async updateSettings(settings) {
    try {
      return await request('/settings', { method: 'PUT', body: settings });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.updateSettings(settings);
      }
      throw err;
    }
  },

  async changePin(currentPin, newPin) {
    try {
      return await request('/settings/pin', { method: 'PUT', body: { currentPin, newPin } });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.changePin(currentPin, newPin);
      }
      throw err;
    }
  },

  // ----------------------------------------------------
  // WhatsApp
  // ----------------------------------------------------
  async getWhatsAppStatus() {
    try {
      return await request('/whatsapp/status');
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.getWhatsAppStatus();
      }
      throw err;
    }
  },

  async connectWhatsApp() {
    try {
      return await request('/whatsapp/connect', { method: 'POST' });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.connectWhatsApp();
      }
      throw err;
    }
  },

  async disconnectWhatsApp() {
    try {
      return await request('/whatsapp/disconnect', { method: 'POST' });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.disconnectWhatsApp();
      }
      throw err;
    }
  },

  async simulateWhatsAppMessage(text, asUserId) {
    try {
      return await request('/whatsapp/simulate', { method: 'POST', body: { text, asUserId } });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.simulateWhatsAppMessage(text, asUserId);
      }
      throw err;
    }
  },

  async sendTestDigest() {
    try {
      return await request('/whatsapp/test-digest', { method: 'POST' });
    } catch (err) {
      if (err.message === 'USING_LOCAL_FALLBACK' || useLocalFallback) {
        return mockStorage.sendTestDigest();
      }
      throw err;
    }
  }
};
