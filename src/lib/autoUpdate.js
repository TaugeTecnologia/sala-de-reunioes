import { useEffect } from 'react';

const CHECK_MS = 60_000;
const scriptOf = (html) => /assets\/index-[\w-]+\.js/.exec(html)?.[0] || null;

/** Recarrega a página sozinha quando uma nova versão do front é publicada. */
export function useAutoUpdate() {
  useEffect(() => {
    if (!import.meta.env?.PROD) return undefined;
    const current = scriptOf([...document.scripts].map((script) => script.src).join(' '));
    if (!current) return undefined;
    let stopped = false;
    async function check() {
      if (stopped || document.hidden) return;
      // Não recarrega enquanto alguém digita no login.
      if ([...document.querySelectorAll('.login-card input')].some((input) => input.value)) return;
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: 'no-store' });
        const latest = scriptOf(await response.text());
        if (response.ok && latest && latest !== current) location.reload();
      } catch { /* sem rede: tenta no próximo ciclo */ }
    }
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', check);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, []);
}
