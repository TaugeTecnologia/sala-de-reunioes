import { periodAt } from './periods.js';
import { API_BASE, apiUrl } from './api.js';

/** Uma conexão por mês consultado; o servidor compartilha a coleta entre abas. */
export function connectAgenda({ year, month = periodAt().mes, onAgenda, onState, onConnection, getTicket = null, EventSourceClass = globalThis.EventSource }) {
  let active = true;
  let source = null;
  let retry = null;
  let detach = () => {};
  onConnection('conectando');
  const parse = (event) => {
    try { return JSON.parse(event.data); } catch { return null; }
  };
  const handleAgenda = (event) => {
    if (!active) return;
    const agenda = parse(event);
    if (agenda?.periodo?.ano !== year || agenda.periodo.mes !== month || !Array.isArray(agenda.eventos) || !Array.isArray(agenda.salas)) return;
    onAgenda(agenda);
  };
  const handleState = (event) => {
    if (!active) return;
    const state = parse(event);
    if (state?.ano !== year || state.mes !== month || !['ocioso', 'executando', 'concluido', 'erro'].includes(state.estado)) return;
    onState(state);
  };
  const handleOpen = () => { if (active) onConnection('conectado'); };
  const scheduleReconnect = () => { if (active && getTicket && !retry) retry = setTimeout(() => { retry = null; connect(); }, 3000); };
  const handleError = () => {
    if (!active) return;
    onConnection('reconectando');
    // Com bilhete, uma conexão encerrada (bilhete vencido) precisa ser reaberta com um novo.
    if (getTicket && source?.readyState === 2) { detach(); scheduleReconnect(); }
  };
  const handlers = { agenda: handleAgenda, estado: handleState, open: handleOpen, error: handleError };

  async function connect() {
    let suffix = '';
    if (getTicket) {
      try {
        const ticket = await getTicket();
        if (!active) return;
        if (!ticket) { onConnection('reconectando'); return; }
        suffix = `&ticket=${encodeURIComponent(ticket)}`;
      } catch { if (active) { onConnection('reconectando'); scheduleReconnect(); } return; }
    }
    try {
      source = new EventSourceClass(apiUrl(`/api/eventos?ano=${encodeURIComponent(year)}&mes=${encodeURIComponent(month)}${suffix}`), API_BASE ? { withCredentials: true } : undefined);
    } catch {
      onConnection('indisponivel');
      return;
    }
    const current = source;
    for (const [name, handler] of Object.entries(handlers)) current.addEventListener(name, handler);
    detach = () => {
      for (const [name, handler] of Object.entries(handlers)) current.removeEventListener(name, handler);
      current.close();
    };
  }

  connect();
  return () => {
    active = false;
    clearTimeout(retry);
    detach();
  };
}

export function connectionLabel(connection, state) {
  if (connection === 'indisponivel') return 'Atualização automática indisponível neste navegador';
  if (connection === 'reconectando') return 'Conexão interrompida · tentando reconectar';
  if (connection !== 'conectado') return 'Conectando atualização automática…';
  if (state?.estado === 'erro') return 'Falha na consulta · nova tentativa automática';
  if (state?.estado === 'executando') return 'Consultando o Google Calendar…';
  return `Atualização automática · intervalo de ${state?.intervaloSegundos || 2}s`;
}

export function shouldAcceptAgenda(incoming, current) {
  if (!current || current.periodo?.ano !== incoming.periodo?.ano || current.periodo?.mes !== incoming.periodo?.mes) return true;
  const previousTime = Date.parse(current.geradoEm);
  const incomingTime = Date.parse(incoming.geradoEm);
  return !Number.isFinite(previousTime) || (Number.isFinite(incomingTime) && incomingTime >= previousTime);
}
