// Mirrors the hardcoded schedule in Frontend/index.html (bookingDates/renderTimes).
export const CLOSED_WEEKDAYS = [0]; // Sunday
export const TIME_SLOTS = ['12:00', '13:00', '14:00', '15:00', '18:00', '19:00', '20:00'];
export const SLOT_MINUTES = 60;
export const BOOKABLE_DAYS_AHEAD = 14;
// The barber can move appointments further out than customers can book.
export const RESCHEDULE_DAYS_AHEAD = 60;
export const SHOP_TIMEZONE = 'Europe/Amsterdam';

export function isClosedOn(dateStr) {
  const weekday = new Date(`${dateStr}T00:00:00`).getDay();
  return CLOSED_WEEKDAYS.includes(weekday);
}

// Current wall-clock date and time at the shop, independent of the server's timezone.
export function nowInShop(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: SHOP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
