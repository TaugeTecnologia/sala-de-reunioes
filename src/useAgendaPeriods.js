import { useEffect, useState } from 'react';
import { connectAgenda, shouldAcceptAgenda } from './lib/live.js';
import { mergeAgendas, monthPeriod } from './lib/periods.js';

export function useAgendaPeriods(requested) {
  const [snapshots, setSnapshots] = useState({});
  const [states, setStates] = useState({});
  const [connections, setConnections] = useState({});
  const [errors, setErrors] = useState({});
  const [attempt, setAttempt] = useState(0);
  const key = requested.map(period => period.key).sort().join(',');
  useEffect(() => {
    let active = true;
    const periods = key.split(',').map(value => monthPeriod(...value.split('-').map(Number)));
    const cleanup = periods.map(period => {
      const abort = new AbortController();
      const accept = agenda => {
        if (!active || agenda?.periodo?.ano !== period.ano || agenda?.periodo?.mes !== period.mes) return;
        setSnapshots(previous => {
          if (!shouldAcceptAgenda(agenda, previous[period.key])) return previous;
          const next = { ...previous, [period.key]: agenda };
          // Limita o cache local ao navegar por muitos anos.
          for (const oldKey of Object.keys(next)) {
            if (Object.keys(next).length <= 24) break;
            if (!periods.some(item => item.key === oldKey)) delete next[oldKey];
          }
          return next;
        });
        setErrors(previous => ({ ...previous, [period.key]: '' }));
      };
      const close = connectAgenda({ year: period.ano, month: period.mes,
        onAgenda: accept,
        onState: state => { if (active) setStates(previous => ({ ...previous, [period.key]: state })); },
        onConnection: connection => { if (active) setConnections(previous => ({ ...previous, [period.key]: connection })); },
      });
      fetch(`/api/agenda?ano=${period.ano}&mes=${period.mes}`, { cache: 'no-store', signal: abort.signal })
        .then(async response => {
          if (response.status === 401) { window.dispatchEvent(new Event('sessao-expirada')); return; }
          if (response.status === 404) return; // O SSE inicia a primeira coleta desse mês.
          const body = await response.json();
          if (!response.ok) throw new Error(body.erro || 'Não foi possível carregar a agenda.');
          accept(body);
        }).catch(error => {
          if (active && error.name !== 'AbortError') setErrors(previous => ({ ...previous, [period.key]: error.message }));
        });
      return () => { abort.abort(); close(); };
    });
    return () => { active = false; cleanup.forEach(close => close()); };
  }, [key, attempt]);
  const entries = requested.map(period => ({ period, state: states[period.key], connection: connections[period.key], error: errors[period.key] }));
  const failure = entries.find(entry => entry.state?.estado === 'erro');
  const missing = requested.some(period => !snapshots[period.key]);
  const disconnected = entries.find(entry => entry.connection !== 'conectado');
  return {
    data: mergeAgendas(requested, snapshots),
    loading: missing && !failure,
    error: entries.find(entry => entry.error)?.error || '',
    liveState: failure?.state || entries.find(entry => entry.state?.estado === 'executando')?.state || entries[0]?.state,
    liveConnection: disconnected ? disconnected.connection || 'conectando' : missing ? 'conectando' : 'conectado',
    retry: () => setAttempt(value => value + 1),
  };
}
