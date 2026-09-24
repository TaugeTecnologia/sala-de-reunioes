import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { eventStatus, filterEvents, formatDate, formatDuration, formatTime, roomAvailability, nextRoomMeeting, splitMeetings, todaysMeetings, hourlyMeetings } from './lib/agenda.js';
import { currentWeek, weeklyCalendar } from './lib/week.js';
import { connectAgenda, connectionLabel, shouldAcceptAgenda } from './lib/live.js';
import { watchClock } from './lib/clock.js';

const NAV = [{ id: 'visao-geral', label: 'Visão geral', icon: 'grid' }, { id: 'agenda', label: 'Agenda', icon: 'calendar' }];
const PAGES = [...NAV.map(item => item.id), 'sala'];
const ANSWERS = { accepted: ['Aceitou', 'green'], declined: ['Recusou', 'red'], tentative: ['Talvez', 'warning'], needsAction: ['Sem resposta', 'neutral'] };
const EMPTY_FILTERS = { busca: '', data: '', sala: '', status: 'todos' };
const CALENDAR_HOUR_HEIGHT = 56;
const CALENDAR_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MEETING_TABS = [
  { id: 'atuais', label: 'Atuais' },
  { id: 'historico', label: 'Histórico' },
];

function Icon({ name, size = 20, ...props }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2M8 18h2"/></>,
    room: <><path d="M4 21h16M6 21V4l12-2v19M14 12h.01"/><path d="M6 4h12"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    video: <><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>,
    pin: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.calendar}</svg>;
}

function GoogleMark() {
  return <span className="google-mark" aria-hidden="true"><i/><i/><i/><i/><b>31</b></span>;
}

function personName(person = {}) {
  return person.nome || person.displayName || person.email?.split('@')[0].replaceAll('.', ' ') || 'Não informado';
}
function initials(person) { return personName(person).split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase()).join(''); }
function roomLabel(name) {
  return name === 'TAUGE CENTRAL-9-Sala de reuniões (8)' ? 'TAUGE CENTRAL - Sala de Reunião' : name;
}
function plainDescription(text) {
  return String(text || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?\s*>|<\/(p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}
function eventKey(event) { return JSON.stringify(event.chave || [event.ical_uid, event.inicio, event.nome]); }
function rangeTime(event) {
  if (event.dia_inteiro) return 'Dia inteiro';
  if (formatDate(event.inicio) !== formatDate(event.fim)) return `${formatDate(event.inicio, { day: '2-digit', month: '2-digit' })} ${formatTime(event.inicio)} — ${formatDate(event.fim, { day: '2-digit', month: '2-digit' })} ${formatTime(event.fim)}`;
  return `${formatTime(event.inicio)} — ${formatTime(event.fim)}`;
}

async function request(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let body;
  try { body = await response.json(); } catch { throw new Error('O serviço de dados não respondeu. Confira se o painel foi iniciado por completo.'); }
  if (!response.ok) throw new Error(body.erro || 'Não foi possível carregar os dados.');
  return body;
}

function Pill({ tone = 'neutral', children }) { return <span className={`pill ${tone}`}><span className="pill-dot"/>{children}</span>; }
function Empty({ title = 'Nenhum evento encontrado', children }) { return <div className="empty-state"><span className="empty-icon"><Icon name="calendar" size={28}/></span><h3>{title}</h3><p>{children || 'Experimente outra data ou ajuste os filtros da agenda.'}</p></div>; }

function EventList({ slots, open, now }) {
  return <div className="event-list daily-event-list">
    <div className="event-table-head"><span>Horário / data</span><span>Evento</span><span>Organizador</span><span>Convidados</span><span>Situação</span><span/></div>
    <div className="event-list-rows">{slots.flatMap(slot => {
      const date = <div className="event-date"><strong>{formatTime(slot.start)}</strong><small>{formatDate(slot.start, { day: '2-digit', month: 'short' })}</small></div>;
      if (!slot.entries.length) {
        return <div className="event-row empty-hour-row" key={slot.start} data-hour={slot.start}>
          {date}<span/><span/><span/><span/><span/>
        </div>;
      }
      return slot.entries.map(({ event, continuation }) => {
        const status = eventStatus(event, now);
        const participants = event.participantes || {};
        const guests = (participants.lista || []).map(person => `${personName(person)}${person.convidados_adicionais > 0 ? ` (+${person.convidados_adicionais})` : ''}`).join(', ');
        const guestLabel = guests || (participants.pessoas_convidadas === 0 ? 'Sem convidados' : 'Não informados');
        const guestDescription = `${guestLabel}${participants.lista_possivelmente_incompleta ? ' · Lista possivelmente incompleta' : ''}`;
        return <button className="event-row" key={`${slot.start}-${eventKey(event)}`} data-hour={slot.start} onClick={() => open(event)} title={`${event.nome} · ${rangeTime(event)}`} aria-label={`Ver detalhes de ${event.nome}${continuation ? ', continuação nesta faixa' : ''}`}>
          {date}
          <div className="event-identity"><span><strong>{event.nome}</strong><small>{continuation ? 'Continuação · ' : ''}{rangeTime(event)}</small></span></div>
          <span className="event-organizer" title={event.organizador?.email || personName(event.organizador)}>{personName(event.organizador)}</span>
          <span className="event-guests" title={guestDescription}>{Number.isFinite(participants.pessoas_convidadas) && <small>{participants.pessoas_convidadas} {participants.pessoas_convidadas === 1 ? 'convidado' : 'convidados'}</small>}<span>{guestDescription}</span></span>
          <Pill tone={status.tone}>{status.label}</Pill><Icon name="chevron" size={17}/>
        </button>;
      });
    })}</div>
  </div>;
}

function ScrollableEventList({ events, open, now }) {
  const [expanded, setExpanded] = useState(false);
  const viewport = useRef(null);
  const listId = useId();
  const slots = hourlyMeetings(events, now);
  const dayStart = slots[0]?.start;

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node || dayStart === undefined || expanded) return;
    const current = Date.now();
    const hour = dayStart + Math.max(0, Math.min(23, Math.floor((current - dayStart) / 3_600_000))) * 3_600_000;
    const row = node.querySelector(`[data-hour="${hour}"]`);
    const heading = node.querySelector('.event-table-head');
    if (row) node.scrollTop = Math.max(0, row.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop - (heading?.getBoundingClientRect().height || 0) - node.clientTop);
  }, [dayStart, expanded]);

  function toggleExpanded() {
    if (viewport.current && !expanded) viewport.current.scrollTop = 0;
    setExpanded(previous => !previous);
  }

  return <>
    <div id={listId} ref={viewport} className={`meeting-list-viewport ${expanded ? 'is-expanded' : 'is-limited'}`} role="region" aria-label="Reuniões de hoje na sala" tabIndex={0}>
      <EventList slots={slots} open={open} now={now}/>
    </div>
    <div className="meeting-list-actions">
      <span>{expanded ? 'Todos os horários do dia estão visíveis.' : 'Deslize a lista para ver os horários.'}</span>
      <button type="button" className="button secondary meetings-toggle" aria-expanded={expanded} aria-controls={listId} onClick={toggleExpanded}>{expanded ? 'Recolher lista' : 'Exibir tudo'}<Icon name="chevron" size={16}/></button>
    </div>
  </>;
}

function MeetingsPanel({ data, open }) {
  const [now, setNow] = useState(Date.now);
  const [activeTab, setActiveTab] = useState('atuais');
  const tabButtons = useRef({});
  const tabsId = useId();
  useEffect(() => watchClock(setNow), []);
  const events = todaysMeetings(data.eventos, now);
  const groups = splitMeetings(events, now);
  const total = events.length;

  function navigateTabs(event, index) {
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % MEETING_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index + MEETING_TABS.length - 1) % MEETING_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = MEETING_TABS.length - 1;
    else return;
    event.preventDefault();
    const nextTab = MEETING_TABS[nextIndex].id;
    setActiveTab(nextTab);
    tabButtons.current[nextTab]?.focus();
  }

  return <section className="panel bottom-agenda meetings-panel" aria-labelledby="meetings-title">
    <div className="panel-heading meetings-heading">
      <div className="meetings-heading-row">
        <h2 id="meetings-title">Lista de reuniões</h2>
        <div className="meeting-tabs" role="tablist" aria-label="Período das reuniões">
          {MEETING_TABS.map((tab, index) => <button
            type="button" role="tab" className="meeting-tab" key={tab.id}
            id={`${tabsId}-tab-${tab.id}`} aria-controls={`${tabsId}-panel-${tab.id}`}
            aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1}
            ref={node => { tabButtons.current[tab.id] = node; }}
            onClick={() => setActiveTab(tab.id)} onKeyDown={event => navigateTabs(event, index)}
          >{tab.label}<span className="meeting-tab-count">{groups[tab.id].length}</span></button>)}
        </div>
      </div>
      <p>Hoje, {formatDate(now)} · {total} {total === 1 ? 'reunião' : 'reuniões'} no dia</p>
    </div>
    {MEETING_TABS.map(tab => <div
      role="tabpanel" key={tab.id} id={`${tabsId}-panel-${tab.id}`}
      aria-labelledby={`${tabsId}-tab-${tab.id}`} hidden={activeTab !== tab.id}
      className="meeting-tab-panel" tabIndex={0}
    >{activeTab === tab.id && <ScrollableEventList events={groups[tab.id]} open={open} now={now}/>}</div>)}
  </section>;
}

function Calendar({ period, events, open, selectDate, selectedDate, selectedWeek, onWeekChange }) {
  const [now, setNow] = useState(Date.now);
  const viewport = useRef(null);
  const calendarHeader = useRef(null);
  useEffect(() => watchClock(setNow), []);
  const actualWeek = currentWeek(now);
  const days = weeklyCalendar(events, period, now, selectedWeek ?? now);
  const weekStart = days[0].date;
  const weekEnd = days.at(-1).date;
  const today = actualWeek.find(day => day.today).date;
  const isCurrentWeek = weekStart === actualWeek[0].date;
  const hasAllDay = days.some(day => day.allDay.length);

  function changeWeek(direction) {
    const next = days[0].start + direction * 7 * 86_400_000;
    onWeekChange(next === actualWeek[0].start ? null : next);
  }

  const showCurrentTime = useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    const instant = Date.now();
    const day = currentWeek(instant).find(item => item.today);
    const currentMinute = (instant - day.start) / 60_000;
    const visibleHeight = Math.max(0, node.clientHeight - (calendarHeader.current?.offsetHeight || 0));
    // Mantém contexto antes de agora e mais espaço para os próximos horários.
    node.scrollTop = Math.max(0, currentMinute / 60 * CALENDAR_HOUR_HEIGHT - visibleHeight / 3);
  }, []);
  useLayoutEffect(() => {
    showCurrentTime();
  }, [today, showCurrentTime]);

  return <section className="panel calendar-panel weekly-calendar">
    <div className="panel-heading">
      <div aria-live="polite" aria-atomic="true"><h2>{isCurrentWeek ? 'Semana atual' : 'Semana selecionada'}</h2><p>{formatDate(weekStart, { day: '2-digit', month: '2-digit' })} — {formatDate(weekEnd)}</p></div>
      <div className="week-toolbar">
        <span className="calendar-legend"><i/>Evento da sala</span>
        <div className="week-navigation" role="group" aria-label="Navegar pelas semanas">
          <button type="button" className="week-previous" onClick={() => changeWeek(-1)}><Icon name="chevron" size={16}/>Semana anterior</button>
          <button type="button" onClick={() => changeWeek(1)}>Próxima semana<Icon name="chevron" size={16}/></button>
        </div>
      </div>
    </div>
    <div className="week-scroll" ref={viewport} role="region" aria-label="Calendário semanal, com rolagem pelos horários" tabIndex={0} style={{ '--week-hour-height': `${CALENDAR_HOUR_HEIGHT}px` }}>
      <div className="week-grid">
        <div className="week-sticky-header" ref={calendarHeader}>
          <div className="week-heading-row">
            <div className="week-corner">Horário</div>
            {days.map(day => <button type="button" key={day.date}
              className={`week-day-heading ${day.today ? 'is-today' : ''} ${day.date === selectedDate ? 'is-selected' : ''} ${!day.covered ? 'is-unavailable' : ''}`}
              disabled={!day.covered} aria-current={day.today ? 'date' : undefined}
              aria-pressed={day.date === selectedDate}
              onClick={() => selectDate(day.date === selectedDate ? '' : day.date)} aria-label={`Filtrar agenda de ${formatDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}${!day.covered ? ', fora do período consultado' : ''}`}
            ><span>{formatDate(day.date, { weekday: 'short' }).replace('.', '')}</span><strong>{formatDate(day.date, { day: '2-digit', month: '2-digit' })}</strong>{!day.covered && <small>Sem dados</small>}</button>)}
          </div>
          {hasAllDay && <div className="week-all-day-row">
            <div className="week-corner">Dia inteiro</div>
            {days.map(day => <div className="week-all-day-cell" key={day.date}>{day.allDay.map(event => <button type="button" className="week-all-day-event" key={eventKey(event)} onClick={() => open(event)} title={event.nome} aria-label={`${event.nome}, dia inteiro, ${formatDate(day.date)}. Ver detalhes.`}>{event.nome}</button>)}</div>)}
          </div>}
        </div>
        <div className="week-time-grid" style={{ height: 24 * CALENDAR_HOUR_HEIGHT }}>
          <div className="week-hours">{CALENDAR_HOURS.map(hour => <span className="week-hour" key={hour} style={{ top: hour * CALENDAR_HOUR_HEIGHT }}>{String(hour).padStart(2, '0')}:00</span>)}</div>
          {days.map(day => <div className={`week-day-column ${day.today ? 'is-today' : ''} ${!day.covered ? 'is-unavailable' : ''}`} key={day.date} role="group" aria-label={formatDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}>
            {day.timed.map(segment => {
              const event = segment.event;
              const status = eventStatus(event, now);
              const short = segment.displayEndMinute - segment.startMinute < 35;
              return <button type="button" key={eventKey(event)} className={`weekly-event ${status.tone} ${short ? 'is-short' : ''}`} onClick={() => open(event)}
                title={`${event.nome} · ${rangeTime(event)} · ${status.label}`}
                aria-label={`${event.nome}, ${formatDate(day.date)}, ${rangeTime(event)}, ${status.label}. Ver detalhes.`}
                style={{ top: segment.startMinute / 60 * CALENDAR_HOUR_HEIGHT, height: (segment.displayEndMinute - segment.startMinute) / 60 * CALENDAR_HOUR_HEIGHT, left: `calc(${segment.column / segment.columns * 100}% + 3px)`, width: `calc(${100 / segment.columns}% - 6px)` }}
              ><span>{segment.continuesBefore ? 'Continuação' : formatTime(event.inicio)} — {segment.continuesAfter ? '24:00' : formatTime(event.fim)}</span><strong>{event.nome}</strong></button>;
            })}
            {day.currentMinute !== null && <div className="week-now-line" style={{ top: day.currentMinute / 60 * CALENDAR_HOUR_HEIGHT }} aria-hidden="true"/>}
          </div>)}
        </div>
      </div>
    </div>
    {days.some(day => !day.covered) && <p className="week-coverage">Dados disponíveis de {formatDate(period.inicio)} até {formatDate(new Date(Date.parse(period.fim) - 1))}. Os demais dias não foram consultados.</p>}
    <div className="calendar-footer"><Icon name="info" size={15}/><span>Horários de Brasília · Clique em um evento para ver os detalhes.</span></div>
  </section>;
}

function RoomDrawing() {
  return <div className="room-drawing" aria-hidden="true"><div className="drawing-window"><i/><i/><i/></div><div className="drawing-table"/><div className="chair c1"/><div className="chair c2"/><div className="chair c3"/><div className="chair c4"/><div className="chair c5"/><div className="chair c6"/><div className="plant"><i/><i/><i/></div></div>;
}

function RoomAvailabilityCard({ data, liveState, liveConnection }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => watchClock(setNow), []);
  const status = roomAvailability(data, now, { queryState: liveState, connection: liveConnection });
  const tone = status.occupied === null ? 'unknown' : status.occupied ? 'busy' : 'free';
  return <article className={`stat-card occupancy-card ${tone}`}>
    <span className="stat-icon"><Icon name="room"/></span>
    <span className="stat-label">Situação da sala agora</span>
    <strong role="status" aria-live="polite" aria-atomic="true"><span className="occupancy-dot"/>{status.label}</strong>
    <small>{status.reason}</small>
  </article>;
}

function NextMeetingCard({ data }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => watchClock(setNow), []);
  const event = nextRoomMeeting(data, now);
  const startDate = event ? formatDate(event.inicio) : '';
  const endDate = event ? formatDate(event.dia_inteiro ? new Date(Date.parse(event.fim) - 1) : event.fim) : '';
  return <article className="stat-card next-meeting-card">
    <span className="stat-icon violet"><Icon name="calendar"/></span>
    <span className="stat-label">Próxima reunião</span>
    <strong>{event?.nome || (event ? 'Evento sem título' : 'Nenhuma reunião prevista')}</strong>
    {event && <div className="next-meeting-schedule">
      <span>{startDate === endDate ? startDate : `${startDate} — ${endDate}`}</span>
      <span>{event.dia_inteiro ? 'Dia inteiro' : `${formatTime(event.inicio)} — ${formatTime(event.fim)}`}</span>
    </div>}
  </article>;
}

function TodayCard() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => watchClock(setNow), []);
  return <article className="stat-card today-card">
    <span className="stat-icon teal"><Icon name="calendar"/></span>
    <span className="stat-label">Hoje</span>
    <strong>{formatDate(now, { weekday: 'long' })}</strong>
    <small>{formatDate(now)}</small>
  </article>;
}

function Overview({ data, open, goRoom, liveState, liveConnection }) {
  const room = data.salas[0];
  return <>
    <div className="stats-grid">
      <RoomAvailabilityCard data={data} liveState={liveState} liveConnection={liveConnection}/>
      <NextMeetingCard data={data}/>
      <TodayCard/>
      <article className="stat-card"><span className="stat-icon orange"><Icon name="room"/></span><span className="stat-label">Salas acompanhadas</span><strong>{data.salas.length}</strong><small>Agendas selecionadas</small></article>
    </div>
    <div className="overview-grid">
      <MeetingsPanel data={data} open={open}/>
      <div className="overview-aside">
        <section className="room-feature">
          <span className="room-feature-label"><i/>ESPAÇO ACOMPANHADO</span>
          <div className="room-feature-visual"><RoomDrawing/></div>
          <h2>{roomLabel(room?.nome) || 'Sala de reunião'}</h2>
          <p>Os encontros da equipe, em um só lugar.</p>
          <button className="room-link" onClick={goRoom}>Conhecer a agenda da sala <Icon name="arrow" size={18}/></button>
        </section>
      </div>
    </div>
  </>;
}

function Agenda({ data, filters, setFilters, open }) {
  const [selectedWeek, setSelectedWeek] = useState(() => filters.data || null);
  const events = filterEvents(data.eventos, filters);
  const change = (key, value) => {
    setFilters(previous => ({ ...previous, [key]: value }));
    if (key === 'data' && value) setSelectedWeek(value);
  };
  const changeWeek = week => {
    setSelectedWeek(week);
    setFilters(previous => ({ ...previous, data: '' }));
  };
  return <section className="panel agenda-panel"><div className="filters">
    <label className="search-field"><span className="sr-only">Buscar evento ou pessoa</span><Icon name="search"/><input value={filters.busca} placeholder="Buscar evento ou pessoa..." onChange={e => change('busca', e.target.value)}/></label>
    <label><span>Data</span><input type="date" value={filters.data} onChange={e => change('data', e.target.value)}/></label>
    <label><span>Situação da reserva</span><select value={filters.status} onChange={e => change('status', e.target.value)}><option value="todos">Todas as situações</option><option value="confirmados">Confirmadas</option><option value="pendentes">Pendentes</option></select></label>
    {data.salas.length > 1 && <label><span>Sala</span><select value={filters.sala} onChange={e => change('sala', e.target.value)}><option value="">Todas as salas</option>{data.salas.map(s => <option value={s.id} key={s.id}>{roomLabel(s.nome)}</option>)}</select></label>}
    <button className="filter-reset" onClick={() => { setFilters({ ...EMPTY_FILTERS }); setSelectedWeek(null); }}>Limpar</button>
  </div><Calendar period={data.periodo} events={events} open={open} selectDate={date => change('data', date)} selectedDate={filters.data} selectedWeek={selectedWeek} onWeekChange={changeWeek}/></section>;
}

function RoomPage({ data, goAgenda }) {
  const contacts = new Map();
  for (const event of data.eventos) {
    const people = [...(event.participantes?.lista || []), event.criador, event.organizador];
    const counted = new Set();
    for (const p of people) if (p?.email && data.emailsVinculados.includes(p.email.toLowerCase()) && !counted.has(p.email.toLowerCase())) {
      const email = p.email.toLowerCase(); counted.add(email);
      const prior = contacts.get(email);
      contacts.set(email, { ...p, email, count: (prior?.count || 0) + 1 });
    }
  }
  return <div className="room-page-grid"><section className="panel rooms-info"><span className="overline">GOOGLE CALENDAR</span><h2>Um lugar para conectar a equipe.</h2><p className="subtle">Acompanhe os encontros registrados nas agendas das salas selecionadas.</p>{data.salas.map(room => <article className="room-info-card" key={room.id}><span className="stat-icon blue"><Icon name="room" size={25}/></span><h3>{roomLabel(room.nome)}</h3><Pill tone="blue">Agenda acompanhada</Pill><dl><dt>Período consultado</dt><dd>Setembro de {data.periodo.ano}</dd><dt>Fuso horário</dt><dd>Brasília · UTC−03:00</dd><dt>Última atualização</dt><dd>{formatDate(data.geradoEm)} às {formatTime(data.geradoEm)}</dd></dl></article>)}<button className="button primary" onClick={() => goAgenda('')}>Consultar agenda <Icon name="arrow" size={17}/></button></section>
    <section className="panel contacts-panel"><div className="panel-heading"><div><h2>Pessoas vinculadas</h2><p>Criadores, organizadores e convidados dos eventos.</p></div><span className="count-badge">{contacts.size}</span></div>{contacts.size ? <div className="contacts-list">{[...contacts.values()].sort((a, b) => personName(a).localeCompare(personName(b), 'pt-BR')).map(person => <article className="contact" key={person.email}><span className="avatar">{initials(person)}</span><div><strong>{personName(person)}</strong><span>{person.email}</span></div><small>{person.count} {person.count === 1 ? 'evento' : 'eventos'}</small></article>)}</div> : <Empty title="Nenhuma pessoa informada">Os contatos aparecerão quando estiverem disponíveis nos eventos da sala.</Empty>}</section></div>;
}

function EventDetail({ event, close }) {
  const dialog = useRef(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  const p = event.participantes || {};
  return <dialog ref={dialog} className="event-dialog" onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }} aria-labelledby="event-title"><div className="dialog-inner">
    <div className="dialog-top"><span className="overline">DETALHES DO ENCONTRO</span><button className="icon-button" aria-label="Fechar detalhes" onClick={close}><Icon name="close"/></button></div>
    <h2 id="event-title">{event.nome}</h2><Pill tone={event.bloqueio_confirmado ? 'green' : 'warning'}>{event.bloqueio_confirmado ? 'Reserva confirmada' : 'Reserva a confirmar'}</Pill>
    <div className="detail-time"><Icon name="calendar" size={23}/><div><strong>{formatDate(event.inicio, { weekday: 'long', day: 'numeric', month: 'long' })}</strong><span>{rangeTime(event)}{event.duracao_minutos != null && ` · ${formatDuration(event.duracao_minutos)}`}</span>{event.inicio?.slice(0, 10) !== event.fim?.slice(0, 10) && <small>Fim: {event.fim_legivel || formatDate(event.fim)}</small>}</div></div>
    <div className="detail-meta"><div><span>Criado por</span><strong>{personName(event.criador)}</strong><small>{event.criador?.email}</small></div><div><span>Organizado por</span><strong>{personName(event.organizador)}</strong><small>{event.organizador?.email}</small></div></div>
    <div className="detail-location"><Icon name="pin" size={18}/><span>{roomLabel(event.local) || event.salas?.map(s => roomLabel(s.nome) || s.email).join(', ') || 'Local não informado'}</span></div>
    {event.tem_conferencia_online && <div className="detail-location"><Icon name="video" size={18}/><span>Conferência online disponível no evento.</span></div>}
    <section className="detail-section"><h3>Sobre o encontro</h3><p className="description">{plainDescription(event.descricao) || 'Nenhuma descrição foi informada no Google Calendar.'}</p></section>
    <section className="detail-section"><div className="panel-heading"><h3>Participantes <span className="count-badge">{p.pessoas_convidadas ?? '?'}</span></h3><span className="subtle">{p.aceites_observados ?? 0} aceites</span></div>
      {p.lista?.length ? <div className="participants-list">{p.lista.map((person, i) => { const [label, tone] = ANSWERS[person.resposta] || ['Não informado', 'neutral']; return <div className="participant" key={person.email || i}><span className="avatar">{initials(person)}</span><div><strong>{personName(person)}</strong><small>{person.email}{person.convidados_adicionais > 0 && ` · +${person.convidados_adicionais} acompanhantes`}</small></div><Pill tone={tone}>{label}</Pill></div>; })}</div> : <p className="subtle">A lista de convidados não foi informada.</p>}
      <p className="attendance-note"><Icon name="info" size={15}/>As respostas ao convite não confirmam presença física na sala.</p>
      {p.lista_possivelmente_incompleta && <p className="notice">A lista de convidados pode estar incompleta.</p>}
    </section>
  </div></dialog>;
}

export default function App() {
  const [page, setPage] = useState(() => PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'visao-geral');
  const [year] = useState(2026);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [detailKey, setDetailKey] = useState(null);
  const detail = data?.eventos.find(event => eventKey(event) === detailKey) || null;
  function setDetail(event) { setDetailKey(event ? eventKey(event) : null); }
  const [manualLoading, setManualLoading] = useState(false);
  const [liveState, setLiveState] = useState(null);
  const [liveConnection, setLiveConnection] = useState('conectando');
  const sync = manualLoading || liveState?.estado === 'executando';
  const [syncMessage, setSyncMessage] = useState('');
  const alive = useRef(true);
  const currentRequest = useRef(0);
  const load = useCallback(async () => {
    const id = ++currentRequest.current;
    setLoading(true); setError('');
    try { const result = await request(`/api/agenda?ano=${year}`); if (alive.current && id === currentRequest.current) setData(previous => shouldAcceptAgenda(result, previous) ? result : previous); }
    catch (e) { if (alive.current && id === currentRequest.current) setError(e.message); }
    finally { if (alive.current && id === currentRequest.current) setLoading(false); }
  }, [year]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setLiveState(null);
    return connectAgenda({
      year,
      onAgenda: result => {
        // Cache de reconexão ou GET antigo não deve desfazer uma coleta mais nova.
        setData(previous => shouldAcceptAgenda(result, previous) ? result : previous);
        setError(''); setLoading(false);
      },
      onState: setLiveState,
      onConnection: setLiveConnection,
    });
  }, [year]);
  useEffect(() => { if (data && detailKey && !data.eventos.some(event => eventKey(event) === detailKey)) setDetailKey(null); }, [data, detailKey]);
  useEffect(() => { const callback = () => setPage(PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'visao-geral'); window.addEventListener('hashchange', callback); return () => window.removeEventListener('hashchange', callback); }, []);
  function navigate(next) { location.hash = next; setPage(next); }
  function goAgenda(date) { setFilters({ ...EMPTY_FILTERS, data: date }); navigate('agenda'); }
  async function synchronize() {
    setManualLoading(true); setSyncMessage('Solicitando atualização da agenda…');
    try {
      const state = await request('/api/sincronizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ano: year }) });
      if (state.estado === 'erro') throw new Error(state.mensagem || 'Não foi possível atualizar a agenda.');
      if (alive.current) setSyncMessage('Consulta solicitada. Os dados aparecerão automaticamente quando a coleta terminar.');
    } catch (e) { if (alive.current) setSyncMessage(e.message); }
    finally { if (alive.current) setManualLoading(false); }
  }
  const title = page === 'agenda' ? 'Agenda da sala' : page === 'sala' ? 'Sala de reunião' : 'Visão geral';
  return <div className="app-shell"><a className="skip-link" href="#conteudo" onClick={event => { event.preventDefault(); document.getElementById('conteudo')?.focus(); }}>Pular para o conteúdo</a>
    <aside className="sidebar"><div className="brand"><img src="/brand/tauge-logo-light.svg" alt="Tauge Tecnologia" width="190" height="49" draggable={false}/></div><div className="workspace-tag"><span><Icon name="room" size={21}/></span><div><strong>Salas & encontros</strong><small>Gestão de espaços</small></div></div><p className="nav-label">ESPAÇO DE TRABALHO</p><nav aria-label="Navegação principal">{NAV.map(item => <a key={item.id} href={`#${item.id}`} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined}><Icon name={item.icon}/>{item.label}{page === item.id && <span className="nav-active-dot"/>}</a>)}</nav><div className="sidebar-bottom"><div className="calendar-source"><GoogleMark/><div><strong>Google Calendar</strong><small>Dados da agenda da sala</small></div></div><div className="sidebar-footer"><span className="read-dot"/>Painel de acompanhamento</div></div></aside>
    <main id="conteudo" tabIndex={-1}><header className="topbar"><span>Gestão de espaços <Icon name="chevron" size={13}/> <strong>{title}</strong></span><div className="topbar-right"><span className="timezone">Brasília · UTC−03:00</span><span className="workspace-avatar"><img src="/brand/tauge-symbol.svg" width="30" height="30" alt="Tauge" draggable={false}/></span></div></header>
      <div className="main-content"><div className="page-heading"><div><h1>{title}</h1>{page !== 'visao-geral' && <p>{page === 'agenda' ? 'Datas, horários e pessoas. Tudo em uma única agenda.' : 'Conheça a sala e as pessoas que compartilham esse espaço.'}</p>}</div></div>
      <div className="data-meta"><span><span className="read-dot"/>{data ? `Dados atualizados em ${formatDate(data.geradoEm)} às ${formatTime(data.geradoEm)}` : 'Agenda da sala de reunião'}</span></div>
      {liveState?.estado === 'erro' && <div className="sync-message live-error" role="alert"><Icon name="info" size={17}/><span>{liveState.mensagem} Os últimos dados disponíveis foram mantidos.</span></div>}
      {error && data && <div className="sync-message live-error" role="alert"><Icon name="info" size={17}/><span>{error} Exibindo os últimos dados recebidos.</span></div>}
      {syncMessage && <div className="sync-message" role="status"><Icon name="info" size={17}/><span>{syncMessage}</span><button aria-label="Dispensar mensagem" onClick={() => setSyncMessage('')} className="icon-button"><Icon name="close" size={16}/></button></div>}
      {error && !data && liveState?.estado !== 'executando' ? <section className="panel error-panel"><Empty title="A agenda ainda não está disponível">{error}</Empty><button className="button secondary" onClick={load}>Tentar novamente</button></section> : !data ? <div className="loading-state" role="status"><span className="loader"/><p>Preparando a agenda da sala…</p></div> : <>
        {page === 'visao-geral' && <Overview data={data} open={setDetail} goRoom={() => navigate('sala')} liveState={liveState} liveConnection={liveConnection}/>}
        {page === 'agenda' && <Agenda data={data} filters={filters} setFilters={setFilters} open={setDetail}/>}
        {page === 'sala' && <RoomPage data={data} goAgenda={goAgenda}/>}
        {data.avisos?.length > 0 && <div className="coverage-note"><Icon name="info" size={17}/><div><strong>Sobre a cobertura dos dados</strong><p>{[...new Set(data.avisos)].join(' ')}</p></div></div>}
      </>}
      <footer className="main-footer"><span>GESTÃO DE ESPAÇOS</span></footer>
      </div>
    </main>{detail && <EventDetail event={detail} close={() => setDetail(null)}/>}</div>;
}
