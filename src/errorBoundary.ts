import { trackError, track, initTelemetry } from './telemetry';

// Structured client-side error logger. Errors go to the console as before AND
// to telemetry, which is inert unless VITE_TELEMETRY_URL is configured and the
// player hasn't opted out.
export function initErrorBoundary(): void {
  window.onerror = (message, source, line, col, error) => {
    console.error('[SIGNAL] Uncaught error', { message, source, line, col, stack: error?.stack });
    trackError('error', String(message), error?.stack);
    return false; // don't suppress default browser handling
  };

  window.addEventListener('unhandledrejection', (e) => {
    console.error('[SIGNAL] Unhandled promise rejection', { reason: e.reason });
    const reason = e.reason as { message?: string; stack?: string } | string | undefined;
    const message = typeof reason === 'string' ? reason : reason?.message ?? 'unknown';
    const stack = typeof reason === 'object' ? reason?.stack : undefined;
    trackError('unhandled_rejection', message, stack);
  });

  initTelemetry();
}

// Call after WebGL/Three.js init fails — shows a readable message instead of
// a white screen or a raw JS exception in the browser console.
export function showFatalError(reason: string): void {
  // The single most important event to capture: the player saw nothing but an
  // error screen, and by definition cannot report it from inside the game.
  track('webgl_failed', { reason: reason.slice(0, 200) });

  // Remove the Three.js canvas if it was partially created
  const container = document.getElementById('canvas-container');
  if (container) container.innerHTML = '';

  // Hide the normal game UI so it doesn't float over the error
  const ui = document.getElementById('ui-layer');
  if (ui) ui.style.display = 'none';

  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'inset:0', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'background:#05080D',
    'color:#E8FAFF', 'font-family:\'Inter\',sans-serif', 'padding:2rem',
    'text-align:center', 'gap:1rem',
  ].join(';');
  el.innerHTML = `
    <div style="font-size:2rem;">⚠</div>
    <div style="font-size:1.1rem;font-weight:700;letter-spacing:2px;color:#FF3864;">
      SIGNAL CANNOT INITIALIZE
    </div>
    <div style="font-size:0.85rem;color:#6B7785;max-width:340px;line-height:1.6;">
      ${reason}
    </div>
    <div style="font-size:0.75rem;color:#6B7785;margin-top:0.5rem;">
      Try a different browser, or enable hardware acceleration in your browser settings.
    </div>
  `;
  document.body.appendChild(el);
}
