import React, { useCallback, useEffect, useState } from 'react';
import App from './App.jsx';
import Login from './Login.jsx';
import { apiFetch, setToken } from './lib/api.js';
import { useAutoUpdate } from './lib/autoUpdate.js';

const RETRY_MS = 10_000;
const RENEW_MS = 30 * 60 * 1000;

export default function Root() {
  const [state, setState] = useState({ status: 'carregando', config: null, usuario: null });

  const refresh = useCallback(() => apiFetch('/api/auth/sessao', { cache: 'no-store' })
    .then(response => response.json())
    .then(session => { if (!session.autenticado) setToken(null); return session; })
    .then(session => setState({ status: session.autenticado ? 'autenticado' : 'anonimo', config: session, usuario: session.usuario }))
    .catch(() => setState(previous => ({ ...previous, status: 'erro' }))), []);

  useAutoUpdate();
  useEffect(() => { refresh(); }, [refresh]);
  // Servidor indisponível: tenta de novo sozinho até voltar, sem precisar de F5.
  useEffect(() => {
    if (state.status !== 'erro') return undefined;
    const timer = setInterval(refresh, RETRY_MS);
    return () => clearInterval(timer);
  }, [state.status, refresh]);
  useEffect(() => {
    const expired = () => { setToken(null); setState(previous => previous.status === 'autenticado' ? { ...previous, status: 'anonimo', usuario: null } : previous); };
    window.addEventListener('sessao-expirada', expired);
    return () => window.removeEventListener('sessao-expirada', expired);
  }, []);

  // Mantém a sessão viva enquanto o painel está aberto (renovação deslizante).
  useEffect(() => {
    if (state.status !== 'autenticado') return undefined;
    const renew = async () => {
      try {
        const response = await apiFetch('/api/auth/renovar', { method: 'POST' });
        if (response.status === 401) window.dispatchEvent(new Event('sessao-expirada'));
        else if (response.ok) setToken((await response.json()).token);
      } catch { /* sem rede: tenta no próximo ciclo */ }
    };
    const timer = setInterval(renew, RENEW_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) renew(); }, { once: true });
    return () => clearInterval(timer);
  }, [state.status]);

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/sair', { method: 'POST' }).catch(() => {});
    setToken(null);
    setState(previous => ({ ...previous, status: 'anonimo', usuario: null }));
  }, []);

  if (state.status === 'carregando') return <div className="login-loading" role="status">Carregando…</div>;
  if (state.status === 'erro') return <Login config={state.config} offline onRetry={refresh} onAuthenticated={() => {}}/>;
  if (state.status === 'anonimo') return <Login config={state.config} onAuthenticated={usuario => setState(previous => ({ ...previous, status: 'autenticado', usuario }))}/>;
  return <App usuario={state.usuario} onLogout={logout}/>;
}
