// Mirrors the hardcoded schedule in Frontend/index.html (bookingDates/renderTimes).
export const CLOSED_WEEKDAYS = [0]; // Sunday
export const TIME_SLOTS = ['12:00', '13:00', '14:00', '15:00', '18:00', '19:00', '20:00'];
export const BOOKABLE_DAYS_AHEAD = 14;

export function isClosedOn(dateStr) {
  const weekday = new Date(`${dateStr}T00:00:00`).getDay();
  return CLOSED_WEEKDAYS.includes(weekday);
}
