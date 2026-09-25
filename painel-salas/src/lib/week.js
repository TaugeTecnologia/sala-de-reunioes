import { TIME_ZONE, timestamp } from './agenda.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

function dateKey(instant) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(instant).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Semana real no fuso do painel, de segunda-feira a domingo. */
export function currentWeek(now = Date.now()) {
  const instant = timestamp(now);
  if (!Number.isFinite(instant)) throw new RangeError('Data atual inválida.');
  const today = dateKey(instant);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = timestamp(today) - ((weekday + 6) % 7) * DAY;
  return Array.from({ length: 7 }, (_, index) => {
    const start = monday + index * DAY;
    const date = dateKey(start);
    return { date, start, end: start + DAY, today: date === today };
  });
}

function positionEvents(segments) {
  const sorted = [...segments].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
  let cluster = [];
  let laneEnds = [];
  let clusterEnd = -Infinity;
  const finishCluster = () => {
    for (const segment of cluster) segment.columns = laneEnds.length;
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };
  for (const segment of sorted) {
    if (segment.startMinute >= clusterEnd) finishCluster();
    // Espaço mínimo para selecionar eventos curtos sem cobrir outro evento.
    segment.displayEndMinute = Math.min(1440, Math.max(segment.endMinute, segment.startMinute + 20));
    let column = laneEnds.findIndex(end => end <= segment.startMinute);
    if (column === -1) column = laneEnds.length;
    laneEnds[column] = segment.displayEndMinute;
    segment.column = column;
    cluster.push(segment);
    clusterEnd = Math.max(clusterEnd, segment.displayEndMinute);
  }
  finishCluster();
  return sorted;
}

/** Semana exibida de segunda a sábado; não altera nem amplia o período coletado. */
export function weeklyCalendar(events, period, now = Date.now(), weekOf = now, selectedDate = '') {
  const current = timestamp(now);
  const today = dateKey(current);
  const periodStart = timestamp(period?.inicio);
  const periodEnd = timestamp(period?.fim);
  const intervals = events.map(event => ({ event, start: timestamp(event.inicio), end: timestamp(event.fim) }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
  const week = currentWeek(selectedDate || weekOf);
  const visibleDays = selectedDate ? week.filter(day => day.date === selectedDate) : week.slice(0, 6);
  return visibleDays.map(day => {
    const isToday = day.date === today;
    const covered = Number.isFinite(periodStart) && Number.isFinite(periodEnd)
      && day.start >= periodStart && day.end <= periodEnd;
    const allDay = [];
    const timed = [];
    for (const { event, start, end } of intervals) {
      if (!covered || start >= day.end || end <= day.start) continue;
      if (event.dia_inteiro) allDay.push(event);
      else timed.push({
        event,
        startMinute: (Math.max(start, day.start) - day.start) / MINUTE,
        endMinute: (Math.min(end, day.end) - day.start) / MINUTE,
        continuesBefore: start < day.start,
        continuesAfter: end > day.end,
      });
    }
    return {
      ...day, today: isToday, covered, allDay, timed: positionEvents(timed),
      currentMinute: isToday ? (current - day.start) / MINUTE : null,
    };
  });
}
