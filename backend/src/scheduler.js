import cron from 'node-cron';
import { db } from './db.js';
import { sendDailyDigest, sendEndOfTripReminder } from './notifications.js';

/**
 * Automated jobs (PRD section 7).
 *  1. Morning digest at 07:30 Israel time.
 *  2. End-of-trip reminder 15 minutes before a reservation ends.
 *
 * Two things the previous version got wrong:
 *  - No timezone was passed to node-cron, so on a UTC host the "07:30" digest
 *    actually went out at 10:30 Israel time.
 *  - "Already reminded" was tracked in an in-memory Set that grew for ever and
 *    reset on restart, so a restart re-sent reminders. It is now a flag on the
 *    reservation row itself.
 */

const TZ = 'Asia/Jerusalem';
const REMINDER_LEAD_MINUTES = 15;

const jobs = [];

export function initScheduler() {
  console.log('[Scheduler] Registering jobs (timezone: ' + TZ + ')');

  // 1. Daily digest - 07:30 Israel time, every day.
  jobs.push(
    cron.schedule(
      '30 7 * * *',
      async () => {
        try {
          console.log('[Scheduler] Sending the daily digest.');
          await sendDailyDigest();
        } catch (err) {
          console.error('[Scheduler] Daily digest failed:', err.message);
        }
      },
      { timezone: TZ }
    )
  );

  // 2. End-of-trip reminder - checked every minute.
  jobs.push(
    cron.schedule(
      '* * * * *',
      async () => {
        try {
          await runEndOfTripChecks();
        } catch (err) {
          console.error('[Scheduler] End-of-trip check failed:', err.message);
        }
      },
      { timezone: TZ }
    )
  );

  console.log('[Scheduler] ' + jobs.length + ' jobs registered.');
}

export function stopScheduler() {
  for (const job of jobs) {
    try {
      job.stop();
    } catch {
      /* best effort */
    }
  }
  jobs.length = 0;
}

async function runEndOfTripChecks() {
  const now = Date.now();
  const active = db.getReservations().filter((r) => r.status === 'confirmed');

  for (const reservation of active) {
    if (reservation.notified_end) continue;

    const endMs = new Date(reservation.end_time).getTime();
    const minutesLeft = (endMs - now) / 60000;

    // A window rather than an exact minute, so a slow tick or a restart inside
    // the window does not miss the reminder entirely.
    if (minutesLeft > REMINDER_LEAD_MINUTES + 1 || minutesLeft < 0) continue;

    // A 15-minute quick ride would get a reminder at the moment it is created.
    const durationMinutes = (endMs - new Date(reservation.start_time).getTime()) / 60000;
    if (durationMinutes <= REMINDER_LEAD_MINUTES + 5) {
      db.markEndReminderSent(reservation.id);
      continue;
    }

    // Mark first: a failed send must not turn into a reminder loop every minute.
    db.markEndReminderSent(reservation.id);

    // Is someone waiting for the car right after? (PRD: the conditional handoff)
    const nextReservation = active
      .filter((other) => {
        if (other.id === reservation.id) return false;
        const gap = new Date(other.start_time).getTime() - endMs;
        return gap >= -60000 && gap <= 30 * 60000;
      })
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))[0];

    console.log(
      '[Scheduler] End-of-trip reminder for ' + reservation.user?.name +
      (nextReservation ? ' (handoff to ' + nextReservation.user?.name + ')' : '')
    );

    try {
      await sendEndOfTripReminder(reservation, nextReservation || null);
    } catch (err) {
      console.error('[Scheduler] Reminder send failed:', err.message);
    }
  }
}

// Exported so the admin panel can trigger a digest on demand for testing.
export { runEndOfTripChecks };
