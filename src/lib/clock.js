/** Relógio alinhado ao segundo, recuperado imediatamente ao retornar à aba. */
export function watchClock(onTick, {
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  page = globalThis.document, windowTarget = globalThis.window,
} = {}) {
  let timer;
  let stopped = false;
  const update = () => {
    if (stopped) return;
    clearTimer(timer);
    const instant = now();
    onTick(instant);
    timer = setTimer(update, 1000 - (instant % 1000));
  };
  page?.addEventListener('visibilitychange', update);
  windowTarget?.addEventListener('focus', update);
  update();
  return () => {
    stopped = true;
    clearTimer(timer);
    page?.removeEventListener('visibilitychange', update);
    windowTarget?.removeEventListener('focus', update);
  };
}
