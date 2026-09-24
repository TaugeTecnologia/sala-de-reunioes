import React, { useCallback, useEffect, useRef, useState } from 'react';
import { eventStatus, filterEvents, formatDate, formatDuration, formatTime, metrics, monthDays } from './lib/agenda.js';
import { connectAgenda, connectionLabel, shouldAcceptAgenda } from './lib/live.js';

const NAV = [{ id: 'visao-geral', label: 'Visão geral', icon: 'grid' }, { id: 'agenda', label: 'Agenda', icon: 'calendar' }, { id: 'sala', label: 'Sala de reunião', icon: 'room' }];
const ANSWERS = { accepted: ['Aceitou', 'green'], declined: ['Recusou', 'red'], tentative: ['Talvez', 'warning'], needsAction: ['Sem resposta', 'neutral'] };
const EMPTY_FILTERS = { busca: '', data: '', sala: '', status: 'todos' };

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

function EventList({ events, open, compact = false }) {
  if (!events.length) return <Empty/>;
  return <div className={`event-list ${compact ? 'compact' : ''}`}>
    {!compact && <div className="event-table-head"><span>Evento / organizador</span><span>Data e horário</span><span>Convidados</span><span>Situação</span><span/></div>}
    {events.map(event => {
      const status = eventStatus(event);
      const total = event.participantes?.pessoas_convidadas;
      return <button className="event-row" key={eventKey(event)} onClick={() => open(event)} aria-label={`Ver detalhes de ${event.nome}`}>
        <div className="event-identity"><span className="event-symbol"><Icon name={event.tem_conferencia_online ? 'video' : 'calendar'}/></span><span><strong>{event.nome}</strong><small>{personName(event.organizador)}</small></span></div>
        <div className="event-date"><strong>{formatDate(event.inicio, { day: '2-digit', month: 'short' })}</strong><small>{rangeTime(event)}</small></div>
        {!compact && <span className="event-people"><Icon name="people" size={16}/>{total ?? 'Não informado'}</span>}
        <Pill tone={status.tone}>{status.label}</Pill><Icon name="chevron" size={17}/>
      </button>;
    })}
  </div>;
}

function Calendar({ period, events, open, selectDate }) {
  const days = monthDays(period.ano, period.mes);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return <section className="panel calendar-panel">
    <div className="panel-heading"><div><span className="overline">SEU MÊS, EM UM OLHAR</span><h2>Setembro <span className="light">{period.ano}</span></h2></div><span className="calendar-legend"><i/>Evento da sala</span></div>
    <div className="calendar-grid" role="group" aria-label={`Calendário de setembro de ${period.ano}`}>
      {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map(day => <span className="weekday" key={day}>{day}</span>)}
      {days.map(day => {
        const list = day.inMonth ? filterEvents(events, { data: day.date }) : [];
        return <div className={`calendar-day ${!day.inMonth ? 'outside' : ''} ${day.date === today ? 'today' : ''} ${list.length ? 'has-events' : ''}`} key={day.key}>
          <button className="day-number" disabled={!day.inMonth} onClick={() => selectDate(day.date)} aria-label={`Ver agenda de ${formatDate(day.date)}`}>{day.day}</button>
          {list.slice(0, 2).map(event => <button className="calendar-event" title={`${event.nome} · ${rangeTime(event)}`} key={eventKey(event)} onClick={() => open(event)}><span>{formatDate(event.inicio) !== formatDate(day.date) ? 'Continuação' : event.dia_inteiro ? 'Dia inteiro' : formatTime(event.inicio)}</span><b>{event.nome}</b></button>)}
          {list.length > 2 && <button className="more-events" onClick={() => selectDate(day.date)}>+{list.length - 2} eventos</button>}
        </div>;
      })}
    </div>
    <div className="calendar-footer"><Icon name="info" size={15}/><span>Horários de Brasília · Clique em um evento para ver os detalhes.</span></div>
  </section>;
}

function RoomDrawing() {
  return <div className="room-drawing" aria-hidden="true"><div className="drawing-window"><i/><i/><i/></div><div className="drawing-table"/><div className="chair c1"/><div className="chair c2"/><div className="chair c3"/><div className="chair c4"/><div className="chair c5"/><div className="chair c6"/><div className="plant"><i/><i/><i/></div></div>;
}

function Overview({ data, open, goAgenda, goRoom }) {
  const events = data.eventos;
  const stats = metrics(events, data.periodo);
  const next = events.filter(event => event.fim && new Date(event.fim) > new Date()).sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  const room = data.salas[0];
  return <>
    <div className="stats-grid">
      {[['calendar', 'Eventos no mês', stats.eventos, 'Ocorrências sem duplicações', 'blue'], ['clock', 'Tempo agendado', formatDuration(stats.totalMinutos), 'Períodos confirmados na sala', 'violet'], ['people', 'Pessoas convidadas', stats.participantesUnicos, 'E-mails únicos nos eventos', 'teal'], ['room', 'Salas acompanhadas', data.salas.length, 'Agendas selecionadas', 'orange']].map(([icon, label, value, note, color]) => <article className="stat-card" key={label}><span className={`stat-icon ${color}`}><Icon name={icon}/></span><span className="stat-label">{label}</span><strong>{value}</strong><small>{note}</small></article>)}
    </div>
    <div className="overview-grid">
      <Calendar period={data.periodo} events={events} open={open} selectDate={date => goAgenda(date)}/>
      <div className="overview-aside">
        <section className="room-feature"><span className="room-feature-label"><i/>ESPAÇO ACOMPANHADO</span><RoomDrawing/><h2>{room?.nome || 'Sala de reunião'}</h2><p>Os encontros da equipe, em um só lugar.</p><button className="room-link" onClick={goRoom}>Conhecer a agenda da sala <Icon name="arrow" size={18}/></button></section>
        <section className="panel next-panel"><div className="panel-heading"><h2>A seguir</h2><Icon name="clock" size={18}/></div>{next.length ? <>{next.slice(0, 2).map((event, index) => <button className="next-event" key={eventKey(event)} onClick={() => open(event)}><span className={`timeline-dot ${index === 0 ? 'first' : ''}`}/><small>{formatDate(event.inicio, { day: '2-digit', month: 'short' })} · {rangeTime(event)}</small><strong>{event.nome}</strong><span>{event.participantes?.pessoas_convidadas ?? '—'} convidados <Icon name="arrow" size={15}/></span></button>)}</> : <p className="subtle next-empty">Nenhum próximo evento na exportação deste mês.</p>}<button className="text-link" onClick={() => goAgenda('')}>Ver agenda completa <Icon name="arrow" size={16}/></button></section>
      </div>
    </div>
    <section className="panel bottom-agenda"><div className="panel-heading"><div><h2>Encontros de setembro</h2><p>Organização e pessoas por trás de cada reunião.</p></div><button className="text-link" onClick={() => goAgenda('')}>Explorar agenda <Icon name="arrow" size={16}/></button></div><EventList events={events.slice(0, 5)} open={open}/></section>
  </>;
}

function Agenda({ data, filters, setFilters, open }) {
  const events = filterEvents(data.eventos, filters);
  const change = (key, value) => setFilters(previous => ({ ...previous, [key]: value }));
  return <section className="panel agenda-panel"><div className="filters">
    <label className="search-field"><span className="sr-only">Buscar evento ou pessoa</span><Icon name="search"/><input value={filters.busca} placeholder="Buscar evento ou pessoa..." onChange={e => change('busca', e.target.value)}/></label>
    <label><span>Data</span><input type="date" value={filters.data} onChange={e => change('data', e.target.value)}/></label>
    <label><span>Situação da reserva</span><select value={filters.status} onChange={e => change('status', e.target.value)}><option value="todos">Todas as situações</option><option value="confirmados">Confirmadas</option><option value="pendentes">Pendentes</option></select></label>
    {data.salas.length > 1 && <label><span>Sala</span><select value={filters.sala} onChange={e => change('sala', e.target.value)}><option value="">Todas as salas</option>{data.salas.map(s => <option value={s.id} key={s.id}>{s.nome}</option>)}</select></label>}
    <button className="filter-reset" onClick={() => setFilters({ ...EMPTY_FILTERS })}>Limpar</button>
  </div><div className="list-heading"><h2>{events.length} {events.length === 1 ? 'evento encontrado' : 'eventos encontrados'}</h2><span>Setembro de {data.periodo.ano} · UTC−03:00</span></div><EventList events={events} open={open}/></section>;
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
  return <div className="room-page-grid"><section className="panel rooms-info"><span className="overline">GOOGLE CALENDAR</span><h2>Um lugar para conectar a equipe.</h2><p className="subtle">Acompanhe os encontros registrados nas agendas das salas selecionadas.</p>{data.salas.map(room => <article className="room-info-card" key={room.id}><span className="stat-icon blue"><Icon name="room" size={25}/></span><h3>{room.nome}</h3><Pill tone="blue">Agenda acompanhada</Pill><dl><dt>Período consultado</dt><dd>Setembro de {data.periodo.ano}</dd><dt>Fuso horário</dt><dd>Brasília · UTC−03:00</dd><dt>Última atualização</dt><dd>{formatDate(data.geradoEm)} às {formatTime(data.geradoEm)}</dd></dl></article>)}<button className="button primary" onClick={() => goAgenda('')}>Consultar agenda <Icon name="arrow" size={17}/></button></section>
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
    <div className="detail-location"><Icon name="pin" size={18}/><span>{event.local || event.salas?.map(s => s.nome || s.email).join(', ') || 'Local não informado'}</span></div>
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
  const [page, setPage] = useState(() => NAV.some(n => n.id === location.hash.slice(1)) ? location.hash.slice(1) : 'visao-geral');
  const [year, setYear] = useState(2026);
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
  useEffect(() => { const callback = () => setPage(NAV.some(n => n.id === location.hash.slice(1)) ? location.hash.slice(1) : 'visao-geral'); window.addEventListener('hashchange', callback); return () => window.removeEventListener('hashchange', callback); }, []);
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
    <aside className="sidebar"><a className="brand" href="#visao-geral" aria-label="Salas, visão geral"><span className="brand-symbol">s</span><span>salas<span className="brand-dot">.</span></span></a><div className="workspace-tag"><span>T</span><div><strong>Tauge</strong><small>Gestão de espaços</small></div></div><p className="nav-label">ESPAÇO DE TRABALHO</p><nav aria-label="Navegação principal">{NAV.map(item => <a key={item.id} href={`#${item.id}`} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined}><Icon name={item.icon}/>{item.label}{page === item.id && <span className="nav-active-dot"/>}</a>)}</nav><div className="sidebar-bottom"><div className="calendar-source"><GoogleMark/><div><strong>Google Calendar</strong><small>Dados da agenda da sala</small></div></div><div className="sidebar-footer"><span className="read-dot"/>Painel de acompanhamento</div></div></aside>
    <main id="conteudo" tabIndex={-1}><header className="topbar"><span>Espaço de trabalho <Icon name="chevron" size={13}/> <strong>{title}</strong></span><div className="topbar-right"><span className="timezone">Brasília · UTC−03:00</span><span className="workspace-avatar">T</span></div></header>
      <div className="main-content"><div className="page-heading"><div><p className="eyebrow">ENCONTROS QUE CONECTAM</p><h1>{title}</h1><p>{page === 'agenda' ? 'Datas, horários e pessoas. Tudo em uma única agenda.' : page === 'sala' ? 'Conheça a sala e as pessoas que compartilham esse espaço.' : 'Um espaço. Todos os encontros da equipe.'}</p></div><div className="heading-actions"><div className="period-control"><Icon name="calendar" size={17}/><label htmlFor="year">Setembro,</label><select id="year" value={year} disabled={manualLoading} onChange={e => { ++currentRequest.current; setData(null); setLiveState(null); setLiveConnection('conectando'); setSyncMessage(''); setYear(Number(e.target.value)); setFilters({ ...EMPTY_FILTERS }); setDetail(null); }}>{[2024, 2025, 2026, 2027, 2028].map(y => <option value={y} key={y}>{y}</option>)}</select></div><button className="button primary" onClick={synchronize} disabled={sync}><Icon name="refresh" size={17} className={sync ? 'spin' : ''}/>{sync ? 'Atualizando…' : 'Atualizar agora'}</button></div></div>
      <div className="data-meta"><span><span className="read-dot"/>{data ? `Dados atualizados em ${formatDate(data.geradoEm)} às ${formatTime(data.geradoEm)}` : 'Agenda da sala de reunião'}</span><button className="text-link" onClick={load} disabled={loading || sync}>{loading && data ? 'Carregando…' : 'Recarregar dados'}</button></div>
      <div className={`live-connection ${liveConnection === 'conectado' && liveState?.estado !== 'erro' ? 'connected' : 'waiting'}`} role="status">
        <span className="read-dot"/><span>{connectionLabel(liveConnection, liveState)}</span>
        <small>Alterações aparecem após a próxima consulta.</small>
      </div>
      {liveState?.estado === 'erro' && <div className="sync-message live-error" role="alert"><Icon name="info" size={17}/><span>{liveState.mensagem} Os últimos dados disponíveis foram mantidos.</span></div>}
      {error && data && <div className="sync-message live-error" role="alert"><Icon name="info" size={17}/><span>{error} Exibindo os últimos dados recebidos.</span></div>}
      {syncMessage && <div className="sync-message" role="status"><Icon name="info" size={17}/><span>{syncMessage}</span><button aria-label="Dispensar mensagem" onClick={() => setSyncMessage('')} className="icon-button"><Icon name="close" size={16}/></button></div>}
      {error && !data && liveState?.estado !== 'executando' ? <section className="panel error-panel"><Empty title="A agenda ainda não está disponível">{error}</Empty><button className="button secondary" onClick={load}>Tentar novamente</button></section> : !data ? <div className="loading-state" role="status"><span className="loader"/><p>Preparando a agenda da sala…</p></div> : <>
        {page === 'visao-geral' && <Overview data={data} open={setDetail} goAgenda={goAgenda} goRoom={() => navigate('sala')}/>}
        {page === 'agenda' && <Agenda data={data} filters={filters} setFilters={setFilters} open={setDetail}/>}
        {page === 'sala' && <RoomPage data={data} goAgenda={goAgenda}/>}
        {data.avisos?.length > 0 && <div className="coverage-note"><Icon name="info" size={17}/><div><strong>Sobre a cobertura dos dados</strong><p>{[...new Set(data.avisos)].join(' ')}</p></div></div>}
      </>}
      <footer className="main-footer"><span>salas<span className="brand-dot">.</span> <small>Uma visão clara dos encontros.</small></span><span>TAUGE · GESTÃO DE ESPAÇOS</span></footer>
      </div>
    </main>{detail && <EventDetail event={detail} close={() => setDetail(null)}/>}</div>;
}
