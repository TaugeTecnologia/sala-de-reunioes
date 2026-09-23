// One monitor is shared by every tab. Google is consulted only for connected years;
// the sync controller serializes these requests with explicit manual refreshes.
export function createRealtimeMonitor({ sync, load, intervalMs = 15_000, maximumDelayMs = 120_000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const periods = new Map();
  let stopped = false;
  const initialState = (year) => ({ estado: 'ocioso', ano: year, iniciadoEm: null, finalizadoEm: null, mensagem: 'A atualização automática está ativa enquanto o painel estiver aberto.' });
  const period = (year) => {
    if (!periods.has(year)) periods.set(year, { year, clients: new Set(), agenda: null, fingerprint: null, state: initialState(year), failures: 0, due: null, lastQuery: null, timer: null, initialized: false, loading: null });
    return periods.get(year);
  };
  const stateOf = (entry) => ({
    ...entry.state, ano: entry.year, intervaloSegundos: intervalMs / 1000,
    proximaConsultaEm: entry.due === null ? null : new Date(entry.due).toISOString(),
    ultimaConsultaEm: entry.lastQuery,
  });
  const send = (entry, event, data) => {
    for (const listener of entry.clients) listener(event, data);
  };
  const clear = (entry) => {
    if (entry.timer !== null) clearTimer(entry.timer);
    entry.timer = null;
    entry.due = null;
  };
  const emitAgenda = (entry, agenda) => {
    const fingerprint = JSON.stringify(agenda);
    entry.agenda = agenda;
    if (fingerprint !== entry.fingerprint) {
      entry.fingerprint = fingerprint;
      send(entry, 'agenda', agenda);
    }
  };
  const schedule = (entry, delay) => {
    clear(entry);
    if (stopped || !entry.clients.size) return;
    entry.due = now() + Math.max(0, delay);
    entry.timer = setTimer(() => {
      entry.timer = null;
      entry.due = null;
      if (stopped || !entry.clients.size) return;
      sync.start(entry.year, { automatic: true });
    }, Math.max(0, delay));
    entry.timer.unref?.();
  };
  const unsubscribeSync = sync.subscribe?.(({ state, agenda }) => {
    const entry = period(state.ano);
    clear(entry);
    entry.state = state;
    if (state.estado === 'concluido' || state.estado === 'erro') {
      entry.lastQuery = state.finalizadoEm || new Date(now()).toISOString();
      entry.failures = state.estado === 'erro' ? entry.failures + 1 : 0;
      if (agenda) emitAgenda(entry, agenda);
      schedule(entry, Math.min(maximumDelayMs, intervalMs * 2 ** Math.min(entry.failures, 8)));
    }
    send(entry, 'estado', stateOf(entry));
  });
  const initialize = async (entry) => {
    try {
      const agenda = await load(entry.year);
      if (!stopped && (!entry.agenda || Date.parse(agenda.geradoEm) >= Date.parse(entry.agenda.geradoEm))) emitAgenda(entry, agenda);
    } catch {
      // A missing snapshot on the first visit is handled by the first Google query.
    }
    entry.initialized = true;
    entry.loading = null;
    if (stopped || !entry.clients.size || sync.getState(entry.year).estado === 'executando') return;
    const latest = Date.parse(entry.lastQuery || entry.agenda?.geradoEm);
    const delay = Math.min(maximumDelayMs, intervalMs * 2 ** Math.min(entry.failures, 8));
    const remaining = Number.isFinite(latest) ? delay - (now() - latest) : 0;
    schedule(entry, remaining);
    send(entry, 'estado', stateOf(entry));
  };
  return {
    subscribe(year, listener) {
      if (stopped) return () => {};
      const entry = period(year);
      const firstClient = entry.clients.size === 0;
      entry.clients.add(listener);
      listener('estado', stateOf(entry));
      if (entry.agenda) listener('agenda', entry.agenda);
      if (!entry.initialized) {
        entry.loading ||= initialize(entry);
      } else if (firstClient && sync.getState(year).estado !== 'executando') {
        const latest = Date.parse(entry.lastQuery || entry.agenda?.geradoEm);
        const delay = Math.min(maximumDelayMs, intervalMs * 2 ** Math.min(entry.failures, 8));
        schedule(entry, Number.isFinite(latest) ? delay - (now() - latest) : 0);
        listener('estado', stateOf(entry));
      }
      let connected = true;
      return () => {
        if (!connected) return;
        connected = false;
        entry.clients.delete(listener);
        if (!entry.clients.size) {
          clear(entry);
          sync.cancelAutomatic?.(year);
        }
      };
    },
    getState(year = 2026) { return stateOf(period(year)); },
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribeSync?.();
      for (const entry of periods.values()) {
        clear(entry);
        sync.cancelAutomatic?.(entry.year);
        entry.clients.clear();
      }
    },
  };
}
