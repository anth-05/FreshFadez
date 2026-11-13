// Opening hours per weekday (0 = Sunday), as listed on the shop's Salonized page and the website.
// The website shows these hours in index.html (fact_hours_val) and in its structured data.
export const OPENING_HOURS = {
  1: { open: '11:00', close: '21:00' },
  2: { open: '11:00', close: '21:00' },
  3: { open: '11:00', close: '21:00' },
  4: { open: '11:00', close: '21:00' },
  5: { open: '11:00', close: '20:00' },
  6: { open: '10:00', close: '14:00' },
};
export const CLOSED_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6].filter((d) => !OPENING_HOURS[d]);
export const SLOT_MINUTES = 60;
export const BOOKABLE_DAYS_AHEAD = 14;
// The barber can move appointments further out than customers can book.
export const RESCHEDULE_DAYS_AHEAD = 60;
export const SHOP_TIMEZONE = 'Europe/Amsterdam';

export function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00`).getDay();
}

export function isClosedOn(dateStr) {
  return CLOSED_WEEKDAYS.includes(weekdayOf(dateStr));
}

export function hoursOn(dateStr) {
  return OPENING_HOURS[weekdayOf(dateStr)] ?? null;
}

// Whole-hour start times customers can book on a weekday: every hour from opening until the
// last hour before closing.
export function startTimes(weekday) {
  const hours = OPENING_HOURS[weekday];
  if (!hours) return [];
  const out = [];
  for (let t = hours.open; addMinutes(t, SLOT_MINUTES) <= hours.close; t = addMinutes(t, SLOT_MINUTES)) out.push(t);
  return out;
}

export function timeSlotsOn(dateStr) {
  return startTimes(weekdayOf(dateStr));
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
