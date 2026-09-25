import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { eventStatus, filterEvents, formatDate, formatDuration, formatTime, roomAvailability, nextRoomMeeting, splitMeetings, todaysMeetings } from './lib/agenda.js';
import { meetingTimeline, isOffDefaultInterval } from './lib/meeting-timeline.js';
import { currentWeek, weeklyCalendar } from './lib/week.js';
import { maskDateInput, parseDateInput, dateInputCaret, findAgendaFocus, agendaResultWeeks, resultWeekNavigation } from './lib/agenda-filters.js';
import { calendarPeriods, overviewPeriods } from './lib/periods.js';
import { useAgendaPeriods } from './useAgendaPeriods.js';
import { watchClock } from './lib/clock.js';

const NAV = [{ id: 'visao-geral', label: 'Visão geral', icon: 'grid' }, { id: 'agenda', label: 'Agenda', icon: 'calendar' }];
const PAGES = NAV.map(item => item.id);
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

function Pill({ tone = 'neutral', children }) { return <span className={`pill ${tone}`}><span className="pill-dot"/>{children}</span>; }
function Empty({ title = 'Nenhum evento encontrado', children }) { return <div className="empty-state"><span className="empty-icon"><Icon name="calendar" size={28}/></span><h3>{title}</h3><p>{children || 'Experimente outra data ou ajuste os filtros da agenda.'}</p></div>; }

function MeetingHeader({ lanes = 1 }) {
  return <div className="meeting-view-header" style={{ '--meeting-lanes': lanes }}>
    <span className="meeting-time-heading">Horário / data</span>
    {Array.from({ length: lanes }, (_, index) => <div className="meeting-header-lane" key={index}>
      <span>Evento</span><span>Organizador</span><span>Convidados</span><span>Situação</span><span aria-hidden="true"/>
    </div>)}
  </div>;
}

function MeetingTime({ event }) {
  return <span className="meeting-real-time">
    {!event.dia_inteiro && isOffDefaultInterval(event.inicio) && <span className="meeting-exact-dot" role="img" title="Horário exato de início" aria-label="Início diferente dos intervalos padrão de 30 minutos"/>}
    <span>{rangeTime(event)}</span>
  </span>;
}

function MeetingFields({ event, status, showTime }) {
  const participants = event.participantes || {};
  const guests = (participants.lista || []).filter(Boolean).map(person => `${personName(person)}${person.convidados_adicionais > 0 ? ` (+${person.convidados_adicionais})` : ''}`);
  const summary = guests.length ? `${guests.slice(0, 2).join(', ')}${guests.length > 2 ? ` +${guests.length - 2}` : ''}` : participants.pessoas_convidadas === 0 ? 'Sem convidados' : 'Não informados';
  const count = Number.isFinite(participants.pessoas_convidadas) ? `${participants.pessoas_convidadas} ${participants.pessoas_convidadas === 1 ? 'convidado' : 'convidados'}` : 'Convidados';
  return <div className="meeting-content-grid">
    <span className="meeting-title-cell"><strong>{event.nome}</strong>{showTime && <MeetingTime event={event}/>}</span>
    <span className="meeting-organizer-cell" title={event.organizador?.email || personName(event.organizador || {})}>{personName(event.organizador || {})}</span>
    <span className="meeting-guests-cell" title={`${guests.join(', ') || summary}${participants.lista_possivelmente_incompleta ? ' · Lista possivelmente incompleta' : ''}`}><strong>{count}</strong><small>{summary}{participants.lista_possivelmente_incompleta ? ' · parcial' : ''}</small></span>
    <Pill tone={status.tone}>{status.label}</Pill><Icon name="chevron" size={14}/>
  </div>;
}

function meetingStatus(event, now) {
  return event.status === 'cancelled' ? { label: 'Cancelada', tone: 'red' } : eventStatus(event, now);
}

function MeetingItem({ event, now, open, timeline = false, className = '', style }) {
  const status = meetingStatus(event, now);
  return <button type="button" className={`meeting-item ${timeline ? 'meeting-block' : 'meeting-list-row'} ${status.tone} ${className}`} style={style}
    onClick={() => open(event)} title={`${event.nome} · ${rangeTime(event)} · ${status.label}`}
    aria-label={`${event.nome}. ${rangeTime(event)}. ${personName(event.organizador || {})}. ${status.label}. Ver detalhes.`}>
    {!timeline && <span className="meeting-date-cell"><MeetingTime event={event}/><small>{formatDate(event.inicio, { day: '2-digit', month: 'short' })}</small></span>}
    <MeetingFields event={event} status={status} showTime={timeline}/>
  </button>;
}

export function MeetingAgenda({ layout, open, now }) {
  return <div className="meeting-sheet" style={{ '--meeting-lanes': layout.laneCount, '--meeting-sheet-min': `${130 + 650 * layout.laneCount}px`, '--meeting-interval-height': `${layout.intervalHeight}px` }}>
    <div className="meeting-view-sticky">
      <MeetingHeader lanes={layout.laneCount}/>
      {layout.allDay.length > 0 && <div className="meeting-all-day" role="group" aria-label="Reuniões de dia inteiro">{layout.allDay.map(event => <MeetingItem key={eventKey(event)} event={event} now={now} open={open} style={{ width: `calc(130px + (100% - 130px) / ${layout.laneCount})` }}/>)}</div>}
    </div>
    <div className="meeting-timeline-body" style={{ height: layout.height }}>
      <div className="meeting-timeline-guides" aria-hidden="true"/>
      <div className="meeting-time-axis" aria-hidden="true">
        {layout.blocks.filter(block => block.lane === 0).map(block => <span key={eventKey(block.event)} className={`meeting-axis-band ${meetingStatus(block.event, now).tone}`} style={{ top: block.top, height: block.height }}/>) }
        {layout.markers.map(marker => <span key={marker.time} className="meeting-time-mark" style={{ top: marker.top }}>{marker.label}</span>)}
      </div>
      <div className="meeting-timeline-events">{layout.blocks.map(block => <MeetingItem
        key={eventKey(block.event)} event={block.event} now={now} open={open} timeline
        className={`${block.height < 96 ? 'is-compact' : ''}${block.height < 28 ? ' is-tiny' : ''}${block.lane === 0 ? ' spans-time' : ''}`}
        style={{ top: block.top, height: block.height,
          left: block.lane === 0 ? 'calc(-1 * var(--meeting-time-width))' : `calc(${block.lane / layout.laneCount * 100}% + 5px)`,
          width: block.lane === 0 ? `calc(${100 / layout.laneCount}% + var(--meeting-time-width) - 5px)` : `calc(${100 / layout.laneCount}% - 10px)` }}
      />)}</div>
    </div>
  </div>;
}

function ScrollableMeetings({ events, dayEvents, open, now }) {
  const [expanded, setExpanded] = useState(false);
  const viewport = useRef(null);
  const listId = useId();
  const layout = meetingTimeline(events, now, dayEvents);
  const dayStart = layout.dayStart;
  const previousScroll = useRef(null);

  useLayoutEffect(() => {
    const node = viewport.current;
    const heading = node?.querySelector('.meeting-view-sticky');
    if (!heading) return;
    const update = () => node.style.setProperty('--meeting-sticky-height', `${heading.offsetHeight + 6}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(heading);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node || dayStart === null) return;
    const previous = previousScroll.current;
    previousScroll.current = { dayStart, expanded, minuteHeight: layout.minuteHeight, scrollTop: node.scrollTop };
    if (previous && previous.dayStart === dayStart && previous.expanded === expanded) {
      if (!expanded) node.scrollTop = previous.scrollTop / previous.minuteHeight * layout.minuteHeight;
      previousScroll.current.scrollTop = node.scrollTop;
      return;
    }
    node.scrollLeft = 0;
    if (expanded) { node.scrollTop = 0; previousScroll.current.scrollTop = 0; return; }
    const currentMinute = Math.max(0, Math.min(1440, (Date.now() - dayStart) / 60_000));
    node.scrollTop = Math.max(0, currentMinute * layout.minuteHeight - 48);
    previousScroll.current.scrollTop = node.scrollTop;
  }, [dayStart, expanded, layout.minuteHeight]);

  function toggleExpanded() {
    if (viewport.current && !expanded) viewport.current.scrollTop = 0;
    setExpanded(previous => !previous);
  }

  return <>
    <div id={listId} ref={viewport} className={`meeting-list-viewport meetings-view-viewport ${expanded ? 'is-expanded' : 'is-limited'}`} role="region" aria-label={`Agenda com horários de referência a cada ${layout.intervalMinutes} minutos das reuniões de hoje`} tabIndex={0} onScroll={event => { if (previousScroll.current) previousScroll.current.scrollTop = event.currentTarget.scrollTop; }}>
      <MeetingAgenda layout={layout} open={open} now={now}/>
    </div>
    <div className="meeting-list-actions">
      <span>{layout.laneCount > 1 ? 'Reuniões simultâneas lado a lado · Deslize também na horizontal.' : expanded ? `Dia completo · Horários a cada ${layout.intervalMinutes} min.` : `Horários a cada ${layout.intervalMinutes} min · Deslize para ver os horários.`}</span>
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
      <div className="meeting-view-toolbar">
        <p>Hoje, {formatDate(now)} · {total} {total === 1 ? 'reunião' : 'reuniões'} no dia</p>
      </div>
    </div>
    {MEETING_TABS.map(tab => <div
      role="tabpanel" key={tab.id} id={`${tabsId}-panel-${tab.id}`}
      aria-labelledby={`${tabsId}-tab-${tab.id}`} hidden={activeTab !== tab.id}
      className="meeting-tab-panel" tabIndex={0}
    >{activeTab === tab.id && <ScrollableMeetings events={groups[tab.id]} dayEvents={events} open={open} now={now}/>}</div>)}
  </section>;
}

function Calendar({ period, events, open, selectDate, selectedDate, selectedWeek, onWeekChange, focusKey = '', highlightMatches = false, resultNavigation = null, onResultWeekChange }) {
  const [now, setNow] = useState(Date.now);
  const viewport = useRef(null);
  const calendarHeader = useRef(null);
  const lastFocus = useRef('');
  useEffect(() => watchClock(setNow), []);
  const actualWeek = currentWeek(now);
  const days = weeklyCalendar(events, period, now, selectedWeek ?? now, selectedDate);
  const weekStart = days[0].date;
  const weekEnd = days.at(-1).date;
  const today = actualWeek.find(day => day.today).date;
  const isCurrentWeek = weekStart === actualWeek[0].date;
  const hasAllDay = days.some(day => day.allDay.length);

  function changeWeek(direction) {
    if (resultNavigation) {
      const target = direction < 0 ? resultNavigation.previous : resultNavigation.next;
      if (target) onResultWeekChange(target);
      return;
    }
    const next = currentWeek(selectedDate || selectedWeek || now)[0].start + direction * 7 * 86_400_000;
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
  useLayoutEffect(() => {
    if (!focusKey) { lastFocus.current = ''; return; }
    if (!viewport.current || lastFocus.current === focusKey) return;
    const first = days.flatMap(day => day.timed)[0];
    const hasAllDayEvent = days.some(day => day.allDay.length);
    if (!first && !hasAllDayEvent) return;
    viewport.current.scrollTop = hasAllDayEvent ? 0 : Math.max(0, first.startMinute / 60 * CALENDAR_HOUR_HEIGHT - CALENDAR_HOUR_HEIGHT / 2);
    lastFocus.current = focusKey;
  }, [focusKey, days]);

  return <section className={`panel calendar-panel weekly-calendar${selectedDate ? ' day-calendar' : ''}`}>
    <div className="panel-heading">
      <div aria-live="polite" aria-atomic="true"><h2>{selectedDate ? 'Dia selecionado' : resultNavigation?.index >= 0 ? `Semana ${resultNavigation.index + 1} de ${resultNavigation.total}` : isCurrentWeek ? 'Semana atual' : 'Semana selecionada'}</h2><p>{selectedDate ? formatDate(selectedDate, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : <>{formatDate(weekStart, { day: '2-digit', month: '2-digit' })} — {formatDate(weekEnd)}</>}</p></div>
      <div className="week-toolbar">
        <span className="calendar-legend"><i/>{highlightMatches ? 'Resultado dos filtros' : 'Evento da sala'}</span>
        <div className="week-navigation" role="group" aria-label={resultNavigation ? 'Navegar pelas semanas com resultados dos filtros' : 'Navegar pelas semanas'}>
          <button type="button" className="week-previous" disabled={Boolean(resultNavigation && !resultNavigation.previous)} aria-label={resultNavigation ? 'Semana anterior com resultados' : 'Semana anterior'} onClick={() => changeWeek(-1)}><Icon name="chevron" size={16}/>{resultNavigation ? 'Anterior' : 'Semana anterior'}</button>
          <button type="button" disabled={Boolean(resultNavigation && !resultNavigation.next)} aria-label={resultNavigation ? 'Próxima semana com resultados' : 'Próxima semana'} onClick={() => changeWeek(1)}>{resultNavigation ? 'Próxima' : 'Próxima semana'}<Icon name="chevron" size={16}/></button>
        </div>
      </div>
    </div>
    <div className="week-scroll" ref={viewport} role="region" aria-label={`Calendário ${selectedDate ? 'do dia selecionado' : 'semanal'}, com rolagem pelos horários`} tabIndex={0} style={{ '--week-hour-height': `${CALENDAR_HOUR_HEIGHT}px` }}>
      <div className="week-grid">
        <div className="week-sticky-header" ref={calendarHeader}>
          <div className="week-heading-row">
            <div className="week-corner">Horário</div>
            {days.map(day => <button type="button" key={day.date}
              className={`week-day-heading ${day.today ? 'is-today' : ''} ${day.date === selectedDate ? 'is-selected' : ''}`}
              disabled={!day.covered} aria-current={day.today ? 'date' : undefined}
              aria-pressed={day.date === selectedDate}
              onClick={() => selectDate(day.date === selectedDate ? '' : day.date)} aria-label={`Filtrar agenda de ${formatDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}${!day.covered ? ', fora do período consultado' : ''}`}
            ><span>{formatDate(day.date, { weekday: 'short' }).replace('.', '')}</span><strong>{formatDate(day.date, { day: '2-digit', month: '2-digit' })}</strong></button>)}
          </div>
          {hasAllDay && <div className="week-all-day-row">
            <div className="week-corner">Dia inteiro</div>
            {days.map(day => <div className="week-all-day-cell" key={day.date}>{day.allDay.map(event => <button type="button" className={`week-all-day-event${highlightMatches ? ' is-filter-match' : ''}`} key={eventKey(event)} onClick={() => open(event)} title={event.nome} aria-label={`${event.nome}, dia inteiro, ${formatDate(day.date)}. Ver detalhes.`}>{event.nome}</button>)}</div>)}
          </div>}
        </div>
        <div className="week-time-grid" style={{ height: 24 * CALENDAR_HOUR_HEIGHT }}>
          <div className="week-hours">{CALENDAR_HOURS.map(hour => <span className="week-hour" key={hour} style={{ top: hour * CALENDAR_HOUR_HEIGHT }}>{String(hour).padStart(2, '0')}:00</span>)}</div>
          {days.map(day => <div className={`week-day-column ${day.today ? 'is-today' : ''}`} key={day.date} role="group" aria-label={formatDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}>
            {day.timed.map(segment => {
              const event = segment.event;
              const status = eventStatus(event, now);
              const short = segment.displayEndMinute - segment.startMinute < 35;
              return <button type="button" key={eventKey(event)} className={`weekly-event ${status.tone} ${short ? 'is-short' : ''}${highlightMatches ? ' is-filter-match' : ''}`} onClick={() => open(event)}
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

function Overview({ data, open, liveState, liveConnection }) {
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
        </section>
      </div>
    </div>
  </>;
}

function Agenda({ data, filters, setFilters, open, selectedWeek, setSelectedWeek, loading }) {
  const [now, setNow] = useState(Date.now);
  const [resultDay, setResultDay] = useState('');
  const [dateText, setDateText] = useState(() => filters.data ? formatDate(filters.data) : '');
  const dateInput = useRef(null);
  const dateCaret = useRef(null);
  const dateMessageId = useId();
  useEffect(() => watchClock(setNow), []);
  useLayoutEffect(() => {
    if (dateCaret.current === null || !dateInput.current) return;
    dateInput.current.setSelectionRange(dateCaret.current, dateCaret.current);
    dateCaret.current = null;
  }, [dateText]);
  const events = filterEvents(data.eventos, filters, now);
  const selectedDate = filters.data || resultDay;
  const activeFilters = Boolean(filters.busca.trim() || filters.data || filters.sala || filters.status !== 'todos');
  const resultWeeks = activeFilters ? agendaResultWeeks(events, data.periodo, filters.data) : [];
  const resultNavigation = activeFilters ? { ...resultWeekNavigation(resultWeeks, selectedDate || selectedWeek || now), total: resultWeeks.length } : null;
  const visibleDays = weeklyCalendar(events, data.periodo, now, selectedWeek ?? now, selectedDate);
  const visibleCount = new Set(visibleDays.flatMap(day => [...day.allDay, ...day.timed.map(item => item.event)])).size;
  const dateIncomplete = Boolean(dateText && !parseDateInput(dateText));
  const focusKey = activeFilters ? JSON.stringify([filters, selectedWeek, selectedDate]) : '';

  function focusResults(matches) {
    const focus = findAgendaFocus(matches, data.periodo, now, selectedWeek ?? now);
    if (!focus) return;
    setSelectedWeek(focus.date);
    // A semana continua de segunda a sábado; uma busca específica também pode
    // revelar um resultado de domingo na visualização de um único dia.
    setResultDay(focus.sunday ? focus.date : '');
  }
  function navigateResults(week) {
    if (!week) return;
    setSelectedWeek(week.date);
    setResultDay(week.sunday ? week.focusDate : '');
  }
  const change = (key, value) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    if (key === 'data') {
      setDateText(value ? formatDate(value) : '');
      setSelectedWeek(value || null);
      setResultDay('');
    } else if (!next.data) {
      if (next.busca.trim() || next.status !== 'todos' || next.sala) focusResults(filterEvents(data.eventos, next, now));
      else { setSelectedWeek(null); setResultDay(''); }
    }
  };
  function changeDate(event) {
    const raw = event.target.value;
    const masked = maskDateInput(raw);
    const digitsBeforeCaret = raw.slice(0, event.target.selectionStart ?? raw.length).replace(/\D/g, '').length;
    dateCaret.current = dateInputCaret(masked, digitsBeforeCaret);
    const parsed = parseDateInput(masked);
    if (parsed || !masked) change('data', parsed || '');
    setDateText(masked);
  }
  function editDate(event) {
    const input = event.currentTarget;
    const start = input.selectionStart;
    if (start !== input.selectionEnd) return;
    if (event.key === 'Backspace' && input.value[start - 1] === '/') input.setSelectionRange(start - 2, start);
    if (event.key === 'Delete' && input.value[start] === '/') input.setSelectionRange(start, start + 2);
  }
  const changeWeek = week => {
    setSelectedWeek(week);
    setResultDay('');
    setDateText('');
    setFilters(previous => ({ ...previous, data: '' }));
  };
  return <section className="panel agenda-panel"><div className="filters">
    <label className="search-field"><span className="sr-only">Buscar nome da reunião ou pessoa</span><Icon name="search"/><input type="search" value={filters.busca} placeholder="Buscar reunião ou pessoa..." onChange={e => change('busca', e.target.value)}/></label>
    <label className="date-filter"><span>Data</span><input ref={dateInput} type="text" inputMode="numeric" autoComplete="off" placeholder="DD/MM/AAAA" value={dateText} aria-invalid={dateIncomplete && dateText.length === 10} aria-describedby={dateIncomplete ? dateMessageId : undefined} onChange={changeDate} onKeyDown={editDate}/></label>
    <label><span>Situação da reserva</span><select value={filters.status} onChange={e => change('status', e.target.value)}><option value="todos">Todas as situações</option><option value="finalizados">Finalizada</option><option value="em-andamento">Em andamento</option><option value="previstos">Prevista</option></select></label>
    {data.salas.length > 1 && <label><span>Sala</span><select value={filters.sala} onChange={e => change('sala', e.target.value)}><option value="">Todas as salas</option>{data.salas.map(s => <option value={s.id} key={s.id}>{roomLabel(s.nome)}</option>)}</select></label>}
    <button className="filter-reset" onClick={() => { setFilters({ ...EMPTY_FILTERS }); setSelectedWeek(null); setResultDay(''); setDateText(''); }}>Limpar</button>
  </div>
    {dateIncomplete && <p className="filter-feedback" id={dateMessageId} role="status">{dateText.length === 10 ? 'Data inválida. Confira o dia, o mês e o ano.' : 'Digite os oito números: dia, mês e ano. A nova data será aplicada quando estiver completa.'}</p>}
    {activeFilters && <div className="agenda-filter-results">
      <p role="status">{events.length ? `${events.length} ${events.length === 1 ? 'reunião encontrada' : 'reuniões encontradas'} · ${visibleCount} ${selectedDate ? 'neste dia' : 'nesta semana'}.` : loading ? 'Carregando reuniões do período…' : 'Nenhuma reunião encontrada com esses filtros no período consultado.'}</p>
    </div>}
    <Calendar period={data.periodo} events={events} open={open} selectDate={date => change('data', date)} selectedDate={selectedDate} selectedWeek={selectedWeek} onWeekChange={changeWeek} focusKey={focusKey} highlightMatches={activeFilters} resultNavigation={resultNavigation} onResultWeekChange={navigateResults}/>
  </section>;
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

export default function App({ usuario = null, onLogout = null }) {
  const [page, setPage] = useState(() => PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'visao-geral');
  const [now, setNow] = useState(Date.now);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [detailKey, setDetailKey] = useState(null);
  useEffect(() => watchClock(setNow), []);
  const periods = page === 'agenda' ? calendarPeriods(selectedWeek ?? now, filters.data) : overviewPeriods(now);
  const { data, loading, error, liveState, liveConnection, retry } = useAgendaPeriods(periods);
  const detail = data.eventos.find(event => eventKey(event) === detailKey) || null;
  function setDetail(event) { setDetailKey(event ? eventKey(event) : null); }
  useEffect(() => { if (detailKey && !data.eventos.some(event => eventKey(event) === detailKey)) setDetailKey(null); }, [data, detailKey]);
  useEffect(() => { const callback = () => setPage(PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'visao-geral'); window.addEventListener('hashchange', callback); return () => window.removeEventListener('hashchange', callback); }, []);
  const title = page === 'agenda' ? 'Agenda da sala' : 'Visão geral';
  return <div className="app-shell"><a className="skip-link" href="#conteudo" onClick={event => { event.preventDefault(); document.getElementById('conteudo')?.focus(); }}>Pular para o conteúdo</a>
    <aside className="sidebar"><div className="brand"><img src={`${import.meta.env.BASE_URL}brand/tauge-logo-light.svg`} alt="Tauge Tecnologia" width="190" height="49" draggable={false}/></div><div className="workspace-tag"><span><Icon name="room" size={21}/></span><div><strong>Salas & encontros</strong><small>Gestão de espaços</small></div></div><p className="nav-label">ESPAÇO DE TRABALHO</p><nav aria-label="Navegação principal">{NAV.map(item => <a key={item.id} href={`#${item.id}`} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined}><Icon name={item.icon}/>{item.label}{page === item.id && <span className="nav-active-dot"/>}</a>)}</nav><div className="sidebar-bottom"><div className="calendar-source"><GoogleMark/><div><strong>Google Calendar</strong><small>Dados da agenda da sala</small></div></div><div className="sidebar-footer"><span className="read-dot"/>Painel de acompanhamento</div></div></aside>
    <main id="conteudo" tabIndex={-1}><header className="topbar"><span>Gestão de espaços <Icon name="chevron" size={13}/> <strong>{title}</strong></span><div className="topbar-right"><span className="timezone">Brasília · UTC−03:00</span><span className="workspace-avatar"><img src={`${import.meta.env.BASE_URL}brand/tauge-symbol.svg`} width="30" height="30" alt="Tauge" draggable={false}/></span>{usuario && <span className="user-menu"><span className="user-name" title={usuario.email}>{usuario.nome || usuario.email}</span>{onLogout && <button type="button" className="logout-button" onClick={onLogout}>Sair</button>}</span>}</div></header>
      <div className="main-content"><div className="page-heading"><div><h1>{title}</h1>{page === 'agenda' && <p>Datas, horários e pessoas. Tudo em uma única agenda.</p>}</div></div>
      <div className="data-meta"><span><span className="read-dot"/>{data.geradoEm ? `Dados atualizados em ${formatDate(data.geradoEm)} às ${formatTime(data.geradoEm)}` : 'Agenda da sala de reunião'}</span></div>
      {liveState?.estado === 'erro' && <div className="sync-message live-error" role="alert"><Icon name="info" size={17}/><span>{liveState.mensagem} Os últimos dados disponíveis foram mantidos.</span></div>}
      {error && data && <div className="sync-message live-error" role="alert"><Icon name="info" size={17}/><span>{error} Exibindo os últimos dados recebidos.</span></div>}
      {loading && <div className="sync-message" role="status"><Icon name="refresh" size={17}/><span>Carregando reuniões do período selecionado…</span></div>}
      {(error || liveState?.estado === 'erro') && <button type="button" className="button secondary" onClick={retry}>Tentar novamente</button>}
      <div aria-busy={loading}>
        {page === 'visao-geral' && <Overview data={data} open={setDetail} liveState={liveState} liveConnection={liveConnection}/>}
        {page === 'agenda' && <Agenda data={data} filters={filters} setFilters={setFilters} open={setDetail} selectedWeek={selectedWeek} setSelectedWeek={setSelectedWeek} loading={loading}/>}
        {data.avisos?.length > 0 && <div className="coverage-note"><Icon name="info" size={17}/><div><strong>Sobre a cobertura dos dados</strong><p>{[...new Set(data.avisos)].join(' ')}</p></div></div>}
      </div>
      <footer className="main-footer"><span>GESTÃO DE ESPAÇOS</span></footer>
      </div>
    </main>{detail && <EventDetail event={detail} close={() => setDetail(null)}/>}</div>;
}
