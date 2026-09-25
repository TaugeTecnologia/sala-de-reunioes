/** Endereço do backend. Vazio = mesma origem (painel servido pelo próprio servidor). */
export const API_BASE = String(import.meta.env?.VITE_API_URL || '').replace(/\/$/, '');
export const apiUrl = (path) => `${API_BASE}${path}`;

const TOKEN_KEY = 'sala_sessao';
export function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
export function setToken(token) {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* armazenamento indisponível */ }
}

/** A sessão vai no cabeçalho Authorization, sem depender de cookies de terceiros (front em outro domínio). */
export function apiFetch(path, init = {}) {
  const token = getToken();
  const headers = token ? { ...init.headers, Authorization: `Bearer ${token}` } : init.headers;
  return fetch(apiUrl(path), { ...(API_BASE ? { credentials: 'include' } : {}), ...init, ...(headers ? { headers } : {}) });
}

/** Bilhete curto para abrir o EventSource, que não consegue enviar cabeçalhos. */
export async function fetchTicket() {
  const response = await apiFetch('/api/auth/ticket', { method: 'POST' });
  if (response.status === 401) { window.dispatchEvent(new Event('sessao-expirada')); return null; }
  if (!response.ok) throw new Error('ticket');
  return (await response.json()).ticket;
}
