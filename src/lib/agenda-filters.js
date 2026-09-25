import { formatDate, timestamp } from './agenda.js';
import { currentWeek } from './week.js';

/** Um único campo editável: o usuário digita os oito números em sequência. */
export function maskDateInput(value) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

export function parseDateInput(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  if (Number(year) < 100 || Number(year) > 9998) return null;
  const iso = `${year}-${month}-${day}`;
  const instant = timestamp(iso);
  // Date.parse pode normalizar 31/02 para março: a comparação impede isso.
  return Number.isFinite(instant) && formatDate(instant) === value ? iso : null;
}

export function dateInputCaret(masked, digitCount) {
  if (digitCount <= 0) return 0;
  let count = 0;
  for (let index = 0; index < masked.length; index++) {
    if (/\d/.test(masked[index]) && ++count === digitCount) return index + 1;
  }
  return masked.length;
}

/** Leva a busca a um resultado dentro dos dados coletados, sem consultar a API. */
export function findAgendaFocus(events, period, now = Date.now(), weekOf = now) {
  const current = timestamp(now);
  const periodStart = timestamp(period?.inicio);
  const periodEnd = timestamp(period?.fim);
  const week = currentWeek(weekOf);
  const candidates = events.map(event => ({ start: timestamp(event.inicio), end: timestamp(event.fim) }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start
      && item.start < periodEnd && item.end > periodStart)
    .map(item => ({ start: Math.max(item.start, periodStart), end: Math.min(item.end, periodEnd) }));
  const inWeek = candidates.filter(item => item.start < week[5].end && item.end > week[0].start);
  const pool = inWeek.length ? inWeek : candidates;
  const distance = item => current < item.start ? item.start - current : current >= item.end ? current - item.end : 0;
  const chosen = [...pool].sort((a, b) => distance(a) - distance(b) || a.start - b.start)[0];
  if (!chosen) return null;
  const instant = Math.min(chosen.end - 1, Math.max(chosen.start, current));
  // Um evento que atravessa semanas deve focar a parte visível da semana escolhida.
  const visibleInstant = inWeek.length ? Math.max(week[0].start, Math.min(week[5].end - 1, instant)) : instant;
  const date = formatDate(visibleInstant).split('/').reverse().join('-');
  return { date, sunday: new Date(`${date}T12:00:00Z`).getUTCDay() === 0 };
}

/** Semanas com resultados, incluindo continuações e respeitando o fim exclusivo. */
export function agendaResultWeeks(events, period, selectedDate = '') {
  const periodStart = timestamp(period?.inicio);
  const periodEnd = timestamp(period?.fim);
  if (![periodStart, periodEnd].every(Number.isFinite) || periodEnd <= periodStart) return [];
  const dayStart = selectedDate ? timestamp(selectedDate) : periodStart;
  const rangeStart = Math.max(periodStart, dayStart);
  const rangeEnd = Math.min(periodEnd, selectedDate ? dayStart + 86_400_000 : periodEnd);
  if (!Number.isFinite(rangeStart) || rangeEnd <= rangeStart) return [];
  const weeks = new Map();
  for (const event of events) {
    const eventStart = timestamp(event.inicio);
    const eventEnd = timestamp(event.fim);
    if (![eventStart, eventEnd].every(Number.isFinite) || eventEnd <= eventStart) continue;
    const start = Math.max(rangeStart, eventStart);
    const end = Math.min(rangeEnd, eventEnd);
    if (end <= start) continue;
    for (let monday = currentWeek(start)[0].start; monday < end; monday += 7 * 86_400_000) {
      const week = currentWeek(monday);
      const matchingDays = week.filter(day => day.start >= periodStart && day.end <= periodEnd
        && day.start < end && day.end > start);
      if (!matchingDays.length) continue;
      const entry = weeks.get(monday) || { start: monday, date: week[0].date, days: new Map() };
      for (const day of matchingDays) entry.days.set(day.start, day);
      weeks.set(monday, entry);
    }
  }
  return [...weeks.values()].sort((a, b) => a.start - b.start).map(week => {
    const firstDay = [...week.days.values()].sort((a, b) => a.start - b.start)[0];
    return { start: week.start, date: week.date, focusDate: firstDay.date, sunday: firstDay.start === week.start + 6 * 86_400_000 };
  });
}

/** Vizinhas com resultados, mesmo quando a semana aberta não tem correspondências. */
export function resultWeekNavigation(weeks, weekOf = Date.now()) {
  const start = currentWeek(weekOf)[0].start;
  return {
    index: weeks.findIndex(week => week.start === start),
    previous: weeks.findLast(week => week.start < start) || null,
    next: weeks.find(week => week.start > start) || null,
  };
}
