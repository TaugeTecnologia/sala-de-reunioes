import { useEffect, useState } from 'react';
import { apiFetch, fetchTicket, getToken } from './lib/api.js';
import { connectAgenda, shouldAcceptAgenda } from './lib/live.js';
import { mergeAgendas, monthPeriod } from './lib/periods.js';

const POLL_MS = 5000;
const FALLBACK_MS = 6000;
// Túneis rápidos não entregam Server-Sent Events; nesse caso o painel só consulta periodicamente.
const POLL_ONLY = import.meta.env?.VITE_TEMPO_REAL === 'polling';

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
      // Consulta periódica: usada quando o fluxo em tempo real não conecta (ou não é suportado).
      let poll = null;
      let fallback = null;
      let streaming = false;
      const tick = async () => {
        try {
          const query = `ano=${period.ano}&mes=${period.mes}`;
          const [agendaResponse, stateResponse] = await Promise.all([
            apiFetch(`/api/agenda?${query}`, { cache: 'no-store', signal: abort.signal }),
            apiFetch(`/api/sincronizacao?${query}&presenca=1`, { cache: 'no-store', signal: abort.signal }),
          ]);
          if (agendaResponse.status === 401 || stateResponse.status === 401) { window.dispatchEvent(new Event('sessao-expirada')); return; }
          if (!active) return;
          if (agendaResponse.ok) accept(await agendaResponse.json());
          if (stateResponse.ok) { const state = await stateResponse.json(); if (active) setStates(previous => ({ ...previous, [period.key]: state })); }
          if (active) setConnections(previous => ({ ...previous, [period.key]: 'conectado' }));
        } catch { /* tenta de novo no próximo ciclo */ }
      };
      const startPolling = () => { if (poll || !active) return; tick(); poll = setInterval(tick, POLL_MS); };
      const onConnection = connection => {
        if (!active) return;
        if (connection === 'conectado') {
          streaming = true; clearInterval(poll); poll = null; clearTimeout(fallback); fallback = null;
        } else {
          streaming = false;
          if (!fallback && !poll) fallback = setTimeout(() => { fallback = null; if (!streaming) startPolling(); }, FALLBACK_MS);
        }
        if (!(poll && connection !== 'conectado')) setConnections(previous => ({ ...previous, [period.key]: connection }));
      };
      const closeStream = POLL_ONLY ? (startPolling(), () => {}) : connectAgenda({ year: period.ano, month: period.mes, getTicket: getToken() ? fetchTicket : null,
        onAgenda: accept,
        onState: state => { if (active) setStates(previous => ({ ...previous, [period.key]: state })); },
        onConnection,
      });
      const close = () => { closeStream(); clearInterval(poll); clearTimeout(fallback); };
      apiFetch(`/api/agenda?ano=${period.ano}&mes=${period.mes}`, { cache: 'no-store', signal: abort.signal })
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
