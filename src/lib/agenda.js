/** Helpers de apresentação e análise dos eventos normalizados pelo coletor. */
export const TIME_ZONE = 'America/Fortaleza';

const MINUTE = 60_000;
const DAY = 86_400_000;

function text(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function timestamp(value) {
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

/** Todas as reuniões: em andamento, futuras, passadas e horários desconhecidos. */
export function orderMeetings(events, now = Date.now()) {
  const current = timestamp(now);
  const temporal = event => {
    const start = timestamp(event.inicio);
    const end = timestamp(event.fim);
    const valid = [current, start, end].every(Number.isFinite) && end > start;
    const group = !valid ? 3 : current >= end ? 2 : current >= start ? 0 : 1;
    return { event, start, end, group };
  };
  return events.map(temporal).sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group;
    if (a.group === 3) return 0;
    if (a.group === 2) return b.end - a.end || b.start - a.start;
    return a.start - b.start;
  }).map(item => item.event);
}

/** Divide a apresentação pelo fim da reunião, preservando todos os registros. */
export function splitMeetings(events, now = Date.now()) {
  const current = timestamp(now);
  const groups = { atuais: [], historico: [] };
  for (const event of orderMeetings(events, now)) {
    const start = timestamp(event.inicio);
    const end = timestamp(event.fim);
    const finished = [current, start, end].every(Number.isFinite) && end > start && end <= current;
    // Sem um intervalo válido, não presumimos que a reunião terminou.
    groups[finished ? 'historico' : 'atuais'].push(event);
  }
  return groups;
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
    event.nome,
    ...people.flatMap(person => [person?.nome, person?.displayName, person?.email,
      person?.email?.split('@')[0].replace(/[._-]/g, ' ')]),
  ].filter(Boolean).join(' '));
}

/** Situação temporal, independente da confirmação do convite da sala. */
export function meetingPhase(event, now = Date.now()) {
  const start = timestamp(event.inicio);
  const end = timestamp(event.fim);
  const current = timestamp(now);
  if (![start, end, current].every(Number.isFinite) || end <= start) return null;
  return current >= end ? 'finalizados' : current >= start ? 'em-andamento' : 'previstos';
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
    if (['finalizados', 'em-andamento', 'previstos'].includes(status) && meetingPhase(event, now) !== status) return false;
    return true;
  });
}

function localDayStart(now) {
  const current = timestamp(now);
  if (!Number.isFinite(current)) return NaN;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(current).map(part => [part.type, part.value]));
  return timestamp(`${parts.year}-${parts.month}-${parts.day}`);
}

/** Reuniões que ocupam alguma parte de hoje no fuso do painel. */
export function todaysMeetings(events, now = Date.now()) {
  const start = localDayStart(now);
  return Number.isFinite(start) ? events.filter(event => overlaps(event, start, start + DAY)) : [];
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

function confirmedRoomReservations(data) {
  const room = data?.salas?.[0];
  if (!room || !Array.isArray(data.eventos)) return [];
  const key = roomKey(room);
  return uniqueEvents(data.eventos).filter(event => {
    if (event.bloqueio_confirmado !== true || event.status === 'cancelled' || event.transparency === 'transparent') return false;
    if (event.salas?.length) {
      return event.salas.some(linked => roomKey(linked) === key && !['declined', 'tentative', 'needsAction'].includes(linked.resposta));
    }
    return key && (text(event.agenda_copia_utilizada) === key || (event.agendas_origem ?? []).some(id => text(id) === key));
  });
}

/** Próxima reserva que ainda vai começar na sala, dentro do período consultado. */
export function nextRoomMeeting(data, now = Date.now()) {
  const current = timestamp(now);
  const periodStart = timestamp(data?.periodo?.inicio);
  const periodEnd = timestamp(data?.periodo?.fim);
  if (![current, periodStart, periodEnd].every(Number.isFinite)) return null;
  return confirmedRoomReservations(data)
    .filter(event => timestamp(event.inicio) > current && overlaps(event, periodStart, periodEnd))
    .sort((a, b) => timestamp(a.inicio) - timestamp(b.inicio))[0] || null;
}

/** Disponibilidade segundo as reservas da sala, nunca prova de presença física. */
export function roomAvailability(data, now = Date.now(), { connection = 'conectado', queryState, maxAgeMs = 30_000 } = {}) {
  const unavailable = (reason) => ({ label: '—', occupied: null, reason });
  const current = timestamp(now);
  const start = timestamp(data?.periodo?.inicio);
  const end = timestamp(data?.periodo?.fim);
  if (![current, start, end].every(Number.isFinite) || current < start || current >= end) {
    return unavailable('O horário atual está fora do período consultado.');
  }
  const room = data?.salas?.[0];
  if (!room || !['ok', 'acesso_limitado'].includes(room.status) || !Array.isArray(data.eventos)) {
    return unavailable('Aguardando os dados da sala.');
  }
  const generated = timestamp(data.geradoEm);
  if (connection !== 'conectado' || queryState?.estado === 'erro'
      || !Number.isFinite(generated) || current - generated >= maxAgeMs || generated - current > 5_000) {
    return unavailable('Aguardando uma consulta atualizada.');
  }
  const reservations = confirmedRoomReservations(data);
  if (reservations.some(event => !Number.isFinite(timestamp(event.inicio)) || !Number.isFinite(timestamp(event.fim)) || timestamp(event.fim) <= timestamp(event.inicio))) {
    return unavailable('Há uma reserva com horário indisponível.');
  }
  // Início inclusivo e fim exclusivo: muda no início/fim sem esperar outra coleta.
  const occupied = reservations.some(event => timestamp(event.inicio) <= current && current < timestamp(event.fim));
  return {
    label: occupied ? 'Ocupado' : 'Livre', occupied,
    reason: occupied ? 'Reserva em andamento na sala.' : 'Nenhuma reserva neste horário.',
  };
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
