/** Uma conexão por painel; EventSource reconecta sem criar consultas por aba. */
export function connectAgenda({ year, onAgenda, onState, onConnection, EventSourceClass = globalThis.EventSource }) {
  let active = true;
  let source;
  onConnection('conectando');
  try {
    source = new EventSourceClass(`/api/eventos?ano=${encodeURIComponent(year)}`);
  } catch {
    onConnection('indisponivel');
    return () => { active = false; };
  }
  const parse = (event) => {
    try { return JSON.parse(event.data); } catch { return null; }
  };
  const handleAgenda = (event) => {
    if (!active) return;
    const agenda = parse(event);
    if (agenda?.periodo?.ano !== year || !Array.isArray(agenda.eventos) || !Array.isArray(agenda.salas)) return;
    onAgenda(agenda);
  };
  const handleState = (event) => {
    if (!active) return;
    const state = parse(event);
    if (state?.ano !== year || !['ocioso', 'executando', 'concluido', 'erro'].includes(state.estado)) return;
    onState(state);
  };
  const handleOpen = () => { if (active) onConnection('conectado'); };
  const handleError = () => { if (active) onConnection('reconectando'); };
  const handlers = { agenda: handleAgenda, estado: handleState, open: handleOpen, error: handleError };
  for (const [name, handler] of Object.entries(handlers)) source.addEventListener(name, handler);
  return () => {
    active = false;
    for (const [name, handler] of Object.entries(handlers)) source.removeEventListener(name, handler);
    source.close();
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
  if (!current || current.periodo?.ano !== incoming.periodo?.ano) return true;
  const previousTime = Date.parse(current.geradoEm);
  const incomingTime = Date.parse(incoming.geradoEm);
  return !Number.isFinite(previousTime) || (Number.isFinite(incomingTime) && incomingTime >= previousTime);
}
