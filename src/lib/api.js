/** Endereço do backend. Vazio = mesma origem (painel servido pelo próprio servidor). */
export const API_BASE = String(import.meta.env?.VITE_API_URL || '').replace(/\/$/, '');
export const apiUrl = (path) => `${API_BASE}${path}`;
/** Com o front em outro domínio (GitHub Pages), envia o cookie de sessão junto. */
export const apiFetch = (path, init = {}) => fetch(apiUrl(path), API_BASE ? { credentials: 'include', ...init } : init);
