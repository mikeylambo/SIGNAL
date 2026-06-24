import { profile, saveProfile } from '../save';
import { state } from '../state';
import { initAudio } from '../audio';

// Callback registered by modals.ts at load time so the Skip path can call
// returnToMenu() without creating a runLoop → onboarding → modals → runLoop cycle.
let _onSkipComplete: (() => void) | null = null;
export function registerOnboardingSkipHandler(fn: () => void): void {
  _onSkipComplete = fn;
}

// ── Overlay ────────────────────────────────────────────────────────────────────

export function showOnboardingHint(): void {
  document.getElementById('onboarding-hint')?.remove();

  const hint = document.createElement('div');
  hint.id = 'onboarding-hint';
  hint.style.cssText = [
    'position:fixed;inset:0;z-index:100;',
    'display:flex;align-items:center;justify-content:center;',
    'pointer-events:none;',
    'transition:opacity 0.4s ease;opacity:1;',
  ].join('');

  const box = document.createElement('div');
  box.style.cssText = [
    'background:rgba(5,8,13,0.9);backdrop-filter:blur(10px);',
    'border:1px solid rgba(255,255,255,0.1);border-radius:6px;',
    'padding:28px 36px;text-align:center;pointer-events:auto;max-width:280px;',
  ].join('');

  const line1 = document.createElement('div');
  line1.style.cssText = [
    'font-family:var(--font-display);font-size:1.1rem;font-weight:700;',
    'letter-spacing:3px;color:var(--active);text-transform:uppercase;margin-bottom:8px;',
  ].join('');
  line1.textContent = 'WATCH THE TILES';

  const line2 = document.createElement('div');
  line2.style.cssText = 'font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted);letter-spacing:1px;';
  line2.textContent = 'Then tap them back in order.';

  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'Skip';
  skipBtn.style.cssText = [
    'margin-top:20px;padding:8px 22px;width:auto;',
    'font-family:var(--font-mono);font-size:0.72rem;letter-spacing:1.5px;',
    'background:none;border:1px solid rgba(255,255,255,0.2);',
    'color:rgba(255,255,255,0.45);border-radius:2px;cursor:pointer;pointer-events:auto;',
  ].join('');

  skipBtn.addEventListener('click', () => {
    initAudio();
    profile.hasCompletedOnboarding = true;
    profile.hasSeenOnboarding = true;
    saveProfile();
    state.isOnboarding = false;
    fadeOnboardingHint();
    setTimeout(() => _onSkipComplete?.(), 420);
  });

  box.appendChild(line1);
  box.appendChild(line2);
  box.appendChild(skipBtn);
  hint.appendChild(box);
  document.body.appendChild(hint);
}

export function fadeOnboardingHint(): void {
  const hint = document.getElementById('onboarding-hint');
  if (!hint) return;
  hint.style.opacity = '0';
  setTimeout(() => hint.remove(), 400);
}
