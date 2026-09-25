import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from './lib/api.js';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
    const script = existing || Object.assign(document.createElement('script'), { src: GSI_SRC, async: true, defer: true });
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', reject, { once: true });
    if (!existing) document.head.appendChild(script);
  });
}

async function post(route, body) {
  const response = await apiFetch(`/api/auth/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.erro || 'Não foi possível entrar. Tente novamente.');
  return data;
}

function GoogleButton({ clientId, onCredential, onError }) {
  const container = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    loadGoogleScript().then(() => {
      if (!active || !container.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: ({ credential }) => onCredential(credential), auto_select: false, ux_mode: 'popup' });
      const width = Math.min(Math.round(container.current.getBoundingClientRect().width) || 360, 400);
      window.google.accounts.id.renderButton(container.current, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', logo_alignment: 'left', locale: 'pt-BR', width });
    }).catch(() => { if (active) { setFailed(true); onError('Não foi possível carregar o acesso com Google. Verifique sua conexão.'); } });
    return () => { active = false; };
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  return failed ? null : <div ref={container} className="google-slot" aria-label="Entrar com o Google" />;
}

export default function Login({ config, onAuthenticated, offline = false, onRetry }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const domain = config?.dominio || 'tauge.com';

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { onAuthenticated((await post('entrar', { email, senha })).usuario); }
    catch (problem) { setError(problem.message); setSenha(''); setBusy(false); }
  }

  async function googleCredential(credential) {
    setBusy(true); setError('');
    try { onAuthenticated((await post('google', { credential })).usuario); }
    catch (problem) { setError(problem.message); setBusy(false); }
  }

  return <div className="login">
    <section className="login-brand" aria-hidden="false">
      <img className="login-logo" src={`${import.meta.env.BASE_URL}brand/tauge-logo-light.svg`} alt="Tauge Tecnologia" width="240" height="62" draggable={false}/>
      <div className="login-hero">
        <p className="login-eyebrow">Gestão de espaços</p>
        <h1>Sala de Reuniões</h1>
        <p>Consulte a agenda da sala, veja quem está reunido agora e o que vem a seguir, em tempo real.</p>
      </div>
      <small>© Tauge Tecnologia</small>
      <span className="login-orbit" aria-hidden="true"/>
    </section>
    <main className="login-panel">
      <form className="login-card" onSubmit={submit} noValidate>
        <img className="login-symbol" src={`${import.meta.env.BASE_URL}brand/tauge-symbol.svg`} alt="" width="46" height="46" draggable={false}/>
        <h2>Entrar</h2>
        <p className="login-lead">Acesse com seu e-mail institucional da Tauge.</p>
        <div className="login-error" role="alert" aria-live="assertive">{offline ? 'O servidor de acesso está indisponível no momento, por isso não é possível entrar agora. Tentando reconectar automaticamente…' : error}</div>
        {offline && <button type="button" className="login-retry" onClick={onRetry}>Tentar novamente</button>}
        <label htmlFor="login-email">E-mail institucional</label>
        <input id="login-email" type="email" inputMode="email" autoComplete="username" autoFocus required value={email} onChange={event => setEmail(event.target.value)} placeholder={`nome@${domain}`} disabled={busy || offline}/>
        <label htmlFor="login-senha">Senha</label>
        <div className="password-field">
          <input id="login-senha" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={senha} onChange={event => setSenha(event.target.value)} placeholder="Sua senha" disabled={busy || offline}/>
          <button type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)} aria-pressed={showPassword}>{showPassword ? 'Ocultar' : 'Mostrar'}</button>
        </div>
        <button className="login-submit" type="submit" disabled={offline || busy || !email.trim() || !senha}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <div className="login-divider"><span>ou</span></div>
        {config?.googleClientId
          ? <GoogleButton clientId={config.googleClientId} onCredential={googleCredential} onError={setError}/>
          : <button type="button" className="google-fallback" disabled title="O acesso com Google ainda não foi configurado neste ambiente."><GoogleMark/>Entrar com o Google</button>}
        <small className="login-note">Apenas contas <strong>@{domain}</strong> têm acesso.</small>
      </form>
    </main>
  </div>;
}

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>;
}
