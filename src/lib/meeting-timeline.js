import { formatDate, timestamp } from './agenda.js';

export const DEFAULT_INTERVAL_MINUTES = 30;
export const MINUTE_HEIGHT = 3.2;
const MIN_LABEL_HEIGHT = 18;
const MINUTE = 60_000;
const DAY = 1440 * MINUTE;

function greatestCommonDivisor(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

function dayIntervals(events, dayStart, dayEnd) {
  return events.map(event => ({ event, start: timestamp(event.inicio), end: timestamp(event.fim) }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start
      && item.start < dayEnd && item.end > dayStart)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function dayGranularity(intervals, dayStart, dayEnd) {
  let interval = DEFAULT_INTERVAL_MINUTES;
  for (const { event, start, end } of intervals) {
    if (event.dia_inteiro) continue;
    for (const boundary of [Math.max(dayStart, start), Math.min(dayEnd, end)]) {
      const minute = (boundary - dayStart) / MINUTE;
      // A coluna mostra minutos; segundos continuam preservados na posição do bloco.
      if (!Number.isInteger(minute)) return 1;
      interval = greatestCommonDivisor(interval, minute);
      if (interval === 1) return interval;
    }
  }
  return interval;
}

/** Geometria de apresentação: um bloco por ocorrência, sem arredondar horários. */
export function meetingTimeline(events, now = Date.now(), dayEvents = events) {
  const dayStart = timestamp(formatDate(now).split('/').reverse().join('-'));
  const empty = { dayStart: null, markers: [], blocks: [], allDay: [], laneCount: 1, height: 1440 * MINUTE_HEIGHT,
    intervalMinutes: DEFAULT_INTERVAL_MINUTES, intervalHeight: DEFAULT_INTERVAL_MINUTES * MINUTE_HEIGHT, minuteHeight: MINUTE_HEIGHT };
  if (!Number.isFinite(dayStart)) return empty;
  const dayEnd = dayStart + DAY;
  const intervals = dayIntervals(events, dayStart, dayEnd);
  const intervalMinutes = dayGranularity(dayEvents === events ? intervals : dayIntervals(dayEvents, dayStart, dayEnd), dayStart, dayEnd);
  // Em escalas muito pequenas, mantém os horários legíveis e a duração proporcional.
  const minuteHeight = Math.max(MINUTE_HEIGHT, MIN_LABEL_HEIGHT / intervalMinutes);
  const intervalHeight = intervalMinutes * minuteHeight;
  const laneEnds = [];
  const blocks = [];
  const allDay = [];
  for (const { event, start, end } of intervals) {
    if (event.dia_inteiro) { allDay.push(event); continue; }
    const visibleStart = Math.max(dayStart, start);
    const visibleEnd = Math.min(dayEnd, end);
    let lane = laneEnds.findIndex(laneEnd => laneEnd <= visibleStart);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = visibleEnd;
    const startMinute = (visibleStart - dayStart) / MINUTE;
    const endMinute = (visibleEnd - dayStart) / MINUTE;
    blocks.push({
      event, lane, startMinute, endMinute,
      top: startMinute * minuteHeight,
      height: (endMinute - startMinute) * minuteHeight,
      continuesBefore: start < dayStart, continuesAfter: end > dayEnd,
      offGrid: (start - dayStart) % (DEFAULT_INTERVAL_MINUTES * MINUTE) !== 0,
    });
  }
  return {
    dayStart, blocks, allDay, laneCount: Math.max(1, laneEnds.length), height: 1440 * minuteHeight,
    intervalMinutes, intervalHeight, minuteHeight,
    markers: Array.from({ length: 1440 / intervalMinutes }, (_, index) => {
      const minute = index * intervalMinutes;
      return { time: dayStart + minute * MINUTE, top: minute * minuteHeight,
        label: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` };
    }),
  };
}

/** Indicador do início real, sem vincular o evento às linhas da grade. */
export function isOffDefaultInterval(value) {
  const instant = timestamp(value);
  return Number.isFinite(instant) && instant % (DEFAULT_INTERVAL_MINUTES * MINUTE) !== 0;
}
