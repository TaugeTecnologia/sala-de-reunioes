import { TIME_ZONE, timestamp } from './agenda.js';
import { currentWeek } from './week.js';

const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit' });

export function monthPeriod(ano, mes) {
  if (!Number.isInteger(ano) || ano < 1 || ano > 9998 || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new RangeError('Mês ou ano inválido.');
  const key = `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}`;
  const next = `${String(mes === 12 ? ano + 1 : ano).padStart(4, '0')}-${String(mes === 12 ? 1 : mes + 1).padStart(2, '0')}`;
  return { ano, mes, key, inicio: `${key}-01T00:00:00-03:00`, fim: `${next}-01T00:00:00-03:00`, fuso: 'UTC-03:00' };
}

export function periodAt(value = Date.now()) {
  const parts = Object.fromEntries(formatter.formatToParts(timestamp(value)).map(part => [part.type, part.value]));
  return monthPeriod(Number(parts.year), Number(parts.month));
}

export function overviewPeriods(now = Date.now()) {
  const current = periodAt(now);
  return [current, periodAt(current.fim)];
}

export function calendarPeriods(weekOf = Date.now(), selectedDate = '') {
  if (selectedDate) return [periodAt(selectedDate)];
  return [...new Map(currentWeek(weekOf).slice(0, 6).map(day => {
    const period = periodAt(day.date);
    return [period.key, period];
  })).values()];
}

export function occurrenceKey(event) {
  return JSON.stringify(event.chave || [event.ical_uid || event.id_evento, event.inicio, event.nome]);
}

/** Combina apenas os meses solicitados; uma ocorrência entre meses aparece uma vez. */
export function mergeAgendas(periods, snapshots) {
  const ordered = [...periods].sort((a, b) => a.key.localeCompare(b.key));
  const reports = ordered.map(period => snapshots[period.key]).filter(Boolean).sort((a, b) => Date.parse(a.geradoEm) - Date.parse(b.geradoEm));
  const candidates = new Map();
  const rooms = new Map();
  for (const report of reports) {
    for (const room of report.salas) rooms.set(room.id, room);
    for (const event of report.eventos) candidates.set(occurrenceKey(event), { event, report });
  }
  const events = [...candidates.entries()].filter(([key, { event, report }]) => !reports.some(other =>
    Date.parse(other.geradoEm) > Date.parse(report.geradoEm)
    && timestamp(event.inicio) < timestamp(other.periodo.fim) && timestamp(event.fim) > timestamp(other.periodo.inicio)
    && !other.eventos.some(item => occurrenceKey(item) === key)
  )).map(([, { event }]) => event).sort((a, b) => timestamp(a.inicio) - timestamp(b.inicio));
  return {
    periodo: { ...ordered[0], fim: ordered.at(-1).fim },
    periodos: ordered.map(period => snapshots[period.key]?.periodo).filter(Boolean),
    eventos: events, salas: [...rooms.values()],
    geradoEm: reports[0]?.geradoEm || null,
    avisos: [...new Set(reports.flatMap(report => report.avisos || []))],
    coletaFinalizada: reports.length === ordered.length && reports.every(report => report.coletaFinalizada),
  };
}
