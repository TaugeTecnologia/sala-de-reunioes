import { periodAt, monthPeriod } from '../src/lib/periods.js';
// One monitor is shared by every tab. Google is consulted only for connected months;
// the sync controller serializes these requests with explicit manual refreshes.
export function createRealtimeMonitor({ sync, load, intervalMs = 2_000, maximumDelayMs = 120_000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const periods = new Map();
  let stopped = false;
  const initialState = (year, month) => ({ estado: 'ocioso', ano: year, mes: month, iniciadoEm: null, finalizadoEm: null, mensagem: 'A atualização automática está ativa enquanto o painel estiver aberto.' });
  const period = (year, month = periodAt().mes) => {
    const key = monthPeriod(year, month).key;
    if (!periods.has(key)) periods.set(key, { year, month, clients: new Set(), agenda: null, fingerprint: null, state: initialState(year, month), failures: 0, due: null, lastQuery: null, timer: null, initialized: false, loading: null });
    for (const [oldKey, entry] of periods) {
      if (periods.size <= 24) break;
      if (oldKey !== key && !entry.clients.size && !entry.loading && entry.timer === null) periods.delete(oldKey);
    }
    return periods.get(key);
  };
  // A coleta normal fica mais rápida; falhas continuam recuando 30/60/120s.
  const delayFor = (entry) => entry.failures
    ? Math.min(maximumDelayMs, Math.max(15_000, intervalMs) * 2 ** Math.min(entry.failures, 8))
    : intervalMs;
  const stateOf = (entry) => ({
    ...entry.state, ano: entry.year, mes: entry.month, intervaloSegundos: intervalMs / 1000,
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
      sync.start(entry.year, { automatic: true, month: entry.month });
    }, Math.max(0, delay));
    entry.timer.unref?.();
  };
  const unsubscribeSync = sync.subscribe?.(({ state, agenda }) => {
    const entry = period(state.ano, state.mes);
    clear(entry);
    entry.state = state;
    if (state.estado === 'concluido' || state.estado === 'erro') {
      entry.lastQuery = state.finalizadoEm || new Date(now()).toISOString();
      entry.failures = state.estado === 'erro' ? entry.failures + 1 : 0;
      if (agenda) emitAgenda(entry, agenda);
      schedule(entry, delayFor(entry));
    }
    send(entry, 'estado', stateOf(entry));
  });
  const initialize = async (entry) => {
    try {
      const agenda = await load(entry.year, entry.month);
      if (!stopped && (!entry.agenda || Date.parse(agenda.geradoEm) >= Date.parse(entry.agenda.geradoEm))) emitAgenda(entry, agenda);
    } catch {
      // A missing snapshot on the first visit is handled by the first Google query.
    }
    entry.initialized = true;
    entry.loading = null;
    if (stopped || !entry.clients.size || sync.getState(entry.year, entry.month).estado === 'executando') return;
    const latest = Date.parse(entry.lastQuery || entry.agenda?.geradoEm);
    const delay = delayFor(entry);
    const remaining = Number.isFinite(latest) ? delay - (now() - latest) : 0;
    schedule(entry, remaining);
    send(entry, 'estado', stateOf(entry));
  };
  return {
    subscribe(year, listener, month = periodAt().mes) {
      if (stopped) return () => {};
      const entry = period(year, month);
      const firstClient = entry.clients.size === 0;
      entry.clients.add(listener);
      listener('estado', stateOf(entry));
      if (entry.agenda) listener('agenda', entry.agenda);
      if (!entry.initialized) {
        entry.loading ||= initialize(entry);
      } else if (firstClient && sync.getState(year, month).estado !== 'executando') {
        const latest = Date.parse(entry.lastQuery || entry.agenda?.geradoEm);
        const delay = delayFor(entry);
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
          sync.cancelAutomatic?.(year, month);
        }
      };
    },
    getState(year = periodAt().ano, month = periodAt().mes) { return stateOf(period(year, month)); },
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribeSync?.();
      for (const entry of periods.values()) {
        clear(entry);
        sync.cancelAutomatic?.(entry.year, entry.month);
        entry.clients.clear();
      }
    },
  };
}
