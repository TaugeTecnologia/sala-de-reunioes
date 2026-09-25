import React, { useCallback, useEffect, useState } from 'react';
import App from './App.jsx';
import Login from './Login.jsx';

export default function Root() {
  const [state, setState] = useState({ status: 'carregando', config: null, usuario: null });

  const refresh = useCallback(() => fetch('/api/auth/sessao', { cache: 'no-store' })
    .then(response => response.json())
    .then(session => setState({ status: session.autenticado ? 'autenticado' : 'anonimo', config: session, usuario: session.usuario }))
    .catch(() => setState(previous => ({ ...previous, status: 'erro' }))), []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const expired = () => setState(previous => previous.status === 'autenticado' ? { ...previous, status: 'anonimo', usuario: null } : previous);
    window.addEventListener('sessao-expirada', expired);
    return () => window.removeEventListener('sessao-expirada', expired);
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/sair', { method: 'POST' }).catch(() => {});
    setState(previous => ({ ...previous, status: 'anonimo', usuario: null }));
  }, []);

  if (state.status === 'carregando') return <div className="login-loading" role="status">Carregando…</div>;
  if (state.status === 'erro') return <div className="login-loading" role="alert">Não foi possível conectar ao servidor. <button type="button" className="password-toggle" onClick={refresh}>Tentar novamente</button></div>;
  if (state.status === 'anonimo') return <Login config={state.config} onAuthenticated={usuario => setState(previous => ({ ...previous, status: 'autenticado', usuario }))}/>;
  return <App usuario={state.usuario} onLogout={logout}/>;
}
