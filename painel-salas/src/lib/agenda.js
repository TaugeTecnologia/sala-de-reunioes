/** Helpers de apresentação e análise dos eventos normalizados pelo coletor. */
export const TIME_ZONE = 'America/Fortaleza';

const MINUTE = 60_000;
const DAY = 86_400_000;

function text(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function timestamp(value) {
  if (value === null || value === undefined || value === '') return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const iso = String(value);
  // Datas sem hora representam o dia local, e não meia-noite UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return Date.parse(`${iso}T00:00:00-03:00`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(iso)) {
    return Date.parse(`${iso}-03:00`);
  }
  return Date.parse(iso);
}

export function formatDate(iso, options = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  const value = timestamp(iso);
  return Number.isFinite(value)
    ? new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: TIME_ZONE }).format(value)
    : '—';
}

export function formatTime(iso) {
  const value = timestamp(iso);
  return Number.isFinite(value)
    ? new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE,
    }).format(value)
    : '—';
}

export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes)) || Number(minutes) < 0) return '—';
  const total = Math.round(Number(minutes));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return hours ? `${hours} h${remainder ? ` ${remainder} min` : ''}` : `${remainder} min`;
}

/** Situação do evento exportado; não representa disponibilidade atual da sala. */
export function eventStatus(event, now = new Date()) {
  if (event.bloqueio_confirmado !== true) return { label: 'Reserva pendente', tone: 'warning' };
  const start = timestamp(event.inicio);
  const end = timestamp(event.fim);
  const current = timestamp(now);
  if (![start, end, current].every(Number.isFinite) || end <= start) {
    return { label: 'Horário indisponível', tone: 'neutral' };
  }
  if (current >= end) return { label: 'Finalizado', tone: 'neutral' };
  if (current >= start) return { label: 'Em andamento', tone: 'live' };
  return { label: 'Previsto', tone: 'blue' };
}

function overlaps(event, start, end) {
  const eventStart = timestamp(event.inicio);
  const eventEnd = timestamp(event.fim);
  return Number.isFinite(eventStart) && Number.isFinite(eventEnd)
    && eventEnd > eventStart && eventStart < end && eventEnd > start;
}

function roomKey(room) {
  return text(room.email || room.id || room.nome).trim();
}

function searchable(event) {
  const people = [event.criador, event.organizador, ...(event.participantes?.lista ?? [])];
  return text([
    event.nome, event.local,
    ...people.flatMap(person => [person?.nome, person?.displayName, person?.email]),
    ...(event.salas ?? []).flatMap(room => [room.nome, room.email]),
  ].filter(Boolean).join(' '));
}

export function filterEvents(events, { busca = '', data = '', sala = '', status = 'todos' } = {}, now = new Date()) {
  const terms = text(busca).trim().split(/\s+/).filter(Boolean);
  const dayStart = data ? timestamp(data) : null;
  const selectedRoom = text(sala).trim();
  return events.filter(event => {
    if (terms.length && !terms.every(term => searchable(event).includes(term))) return false;
    if (data && (!Number.isFinite(dayStart) || !overlaps(event, dayStart, dayStart + DAY))) return false;
    if (selectedRoom && !(event.salas ?? []).some(room => roomKey(room) === selectedRoom)) return false;
    if (status === 'confirmados' && event.bloqueio_confirmado !== true) return false;
    if (status === 'pendentes' && event.bloqueio_confirmado === true) return false;
    const label = eventStatus(event, now).label;
    if (status === 'finalizados' && label !== 'Finalizado') return false;
    if (status === 'em-andamento' && label !== 'Em andamento') return false;
    if (status === 'previstos' && label !== 'Previsto') return false;
    return true;
  });
}

/** Mês de 1 a 12; grade de semanas completas, iniciando na segunda-feira. */
export function monthDays(ano, mes) {
  if (!Number.isInteger(ano) || ano < 100 || ano > 9999 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new RangeError('Informe um ano válido e um mês entre 1 e 12.');
  }
  const first = new Date(Date.UTC(ano, mes - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const cells = Math.ceil((offset + length) / 7) * 7;
  return Array.from({ length: cells }, (_, index) => {
    const date = new Date(Date.UTC(ano, mes - 1, 1 - offset + index));
    const key = date.toISOString().slice(0, 10);
    return { key, date: key, day: date.getUTCDate(), inMonth: date.getUTCMonth() === mes - 1 };
  });
}

function uniqueEvents(events) {
  const seen = new Set();
  return events.filter((event, index) => {
    // O coletor fornece a chave da ocorrência: recorrências nunca são unidas apenas pelo iCalUID.
    const key = Array.isArray(event.chave) && event.chave.length
      ? `chave:${JSON.stringify(event.chave)}`
      : event.ical_uid
        ? `ical:${JSON.stringify([event.ical_uid, event.inicio])}`
        : event.id_evento
          ? `id:${JSON.stringify([event.agenda_copia_utilizada, event.id_evento, event.inicio])}`
          : `sem-identificador:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unionMinutes(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let lastEnd = -Infinity;
  for (const [start, end] of sorted) {
    total += Math.max(0, end - Math.max(start, lastEnd));
    lastEnd = Math.max(lastEnd, end);
  }
  return total / MINUTE;
}

/**
 * Minutos reservados são a união dos bloqueios por sala, limitada ao período [inicio, fim).
 * Convidados únicos identificados não equivalem a aceites nem a presença física.
 */
export function metrics(events, { inicio, fim } = {}) {
  const start = inicio ? timestamp(inicio) : -Infinity;
  const end = fim ? timestamp(fim) : Infinity;
  const empty = { eventos: 0, totalMinutos: 0, participantesUnicos: 0, confirmados: 0 };
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return empty;
  const scoped = uniqueEvents(events).filter(event => overlaps(event, start, end));
  const participants = new Set();
  const rooms = new Map();
  let confirmed = 0;
  for (const event of scoped) {
    for (const person of event.participantes?.lista ?? []) {
      const email = String(person.email ?? '').trim().toLowerCase();
      if (email && !person.resource && !email.endsWith('@resource.calendar.google.com')) participants.add(email);
    }
    if (event.bloqueio_confirmado !== true) continue;
    confirmed += 1;
    const interval = [Math.max(start, timestamp(event.inicio)), Math.min(end, timestamp(event.fim))];
    const linkedRooms = (event.salas ?? []).filter(room => !['declined', 'tentative', 'needsAction'].includes(room.resposta));
    const keys = new Set(linkedRooms.map(roomKey).filter(Boolean));
    // Eventos sem ID de recurso usam o local disponível, sem inventar uma sala.
    if (!keys.size && !(event.salas?.length)) keys.add(text(event.local || 'sala-nao-informada'));
    for (const key of keys) {
      if (!rooms.has(key)) rooms.set(key, []);
      rooms.get(key).push(interval);
    }
  }
  return {
    eventos: scoped.length,
    totalMinutos: [...rooms.values()].reduce((total, intervals) => total + unionMinutes(intervals), 0),
    participantesUnicos: participants.size,
    confirmados: confirmed,
  };
}
