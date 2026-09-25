import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from './lib/api.js';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const DEFAULT_DOMAIN = 'tauge.com.br';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/** Passo 1: confere se o e-mail é do domínio institucional. */
export function checkEmail(value, domain) {
  const email = value.trim().toLowerCase();
  if (!email) return { status: 'vazio' };
  if (!EMAIL_PATTERN.test(email)) return { status: 'incompleto' };
  if (!email.endsWith(`@${domain}`)) return { status: 'dominio', email };
  return { status: 'ok', email };
}

function GoogleButton({ clientId, domain, email, onCredential, onError }) {
  const container = useRef(null);
  useEffect(() => {
    let active = true;
    loadGoogleScript().then(() => {
      if (!active || !container.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: ({ credential }) => onCredential(credential), auto_select: false, ux_mode: 'popup', hd: domain, login_hint: email });
      container.current.replaceChildren();
      const width = Math.min(Math.round(container.current.getBoundingClientRect().width) || 360, 400);
      window.google.accounts.id.renderButton(container.current, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', locale: 'pt-BR', width });
    }).catch(() => { if (active) onError('Não foi possível carregar o acesso com Google. Verifique sua conexão.'); });
    return () => { active = false; };
  }, [clientId, domain, email]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={container} className="google-slot" aria-label="Continuar com o Google" />;
}

export default function Login({ config, onAuthenticated, offline = false, onRetry }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const domain = config?.dominio || DEFAULT_DOMAIN;
  const check = checkEmail(email, domain);
  const canUseGoogle = check.status === 'ok' && Boolean(config?.googleClientId) && !offline;

  const hint = check.status === 'dominio'
    ? `Use seu e-mail institucional (nome@${domain}).`
    : check.status === 'ok' && !config?.googleClientId && !offline
      ? 'O acesso com Google ainda não foi configurado neste ambiente.'
      : '';

  async function googleCredential(credential) {
    setBusy(true); setError('');
    try {
      const response = await apiFetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.erro || 'Não foi possível entrar. Tente novamente.');
      onAuthenticated(data.usuario);
    } catch (problem) { setError(problem.message); setBusy(false); }
  }

  return <div className="login">
    <section className="login-brand">
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
      <form className="login-card" onSubmit={event => event.preventDefault()} noValidate>
        <img className="login-symbol" src={`${import.meta.env.BASE_URL}brand/tauge-symbol.png`} alt="" width="46" height="46" draggable={false}/>
        <h2>Entrar</h2>
        <p className="login-lead">Informe seu e-mail institucional da Tauge e continue com o Google.</p>
        <div className="login-error" role="alert" aria-live="assertive">{offline ? 'O servidor de acesso está indisponível no momento, por isso não é possível entrar agora. Tentando reconectar automaticamente…' : error}</div>
        {offline && <button type="button" className="login-retry" onClick={onRetry}>Tentar novamente</button>}
        <label htmlFor="login-email">E-mail institucional</label>
        <input id="login-email" type="email" inputMode="email" autoComplete="username" autoFocus required value={email} onChange={event => { setEmail(event.target.value); setError(''); }} placeholder={`nome@${domain}`} disabled={busy || offline} aria-invalid={check.status === 'dominio'} aria-describedby="login-hint"/>
        <div id="login-hint" className={`login-hint${check.status === 'dominio' ? ' invalid' : ''}`} aria-live="polite">{hint}</div>
        {canUseGoogle
          ? <GoogleButton clientId={config.googleClientId} domain={domain} email={check.email} onCredential={googleCredential} onError={setError}/>
          : <button type="button" className="google-fallback" disabled><GoogleMark/>Continuar com o Google</button>}
        {busy && <small className="login-note" role="status">Entrando…</small>}
        <small className="login-note">Apenas contas <strong>@{domain}</strong> têm acesso.</small>
      </form>
    </main>
  </div>;
}

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>;
}
