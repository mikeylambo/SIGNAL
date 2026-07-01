#!/bin/bash
# Run this from your SIGNAL project root
# Fixes: rotation snap + pause-safe countdown

# ── Fix 1: resetPivotRotation — sync targetRot instead of zeroing ──────────────
python3 - << 'PYEOF'
import re

path = 'src/render/loop.ts'
with open(path) as f:
    content = f.read()

old = """export function resetPivotRotation(): void {
  pivotGroup.rotation.x = 0;
  pivotGroup.rotation.y = 0;
}"""

new = """export function resetPivotRotation(): void {
  // Sync targetRot to current pivot angle — no snap on game start
  loopState.targetRot.x = pivotGroup.rotation.x;
  loopState.targetRot.y = pivotGroup.rotation.y;
}"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("✓ resetPivotRotation fixed")
else:
    print("⚠ resetPivotRotation block not found — check src/render/loop.ts manually")
PYEOF

# ── Fix 2: menu idle — += instead of = so player rotation is preserved ─────────
python3 - << 'PYEOF'
path = 'src/render/loop.ts'
with open(path) as f:
    content = f.read()

# Handle both variants (with or without Math.PI/6 prefix from previous patch)
replacements = [
    (
        "    pivotGroup.rotation.x = Math.PI / 6 + Math.sin(timestamp * 0.0003) * 0.08;",
        "    // Drift gently from current angle — no snap to fixed position\n    pivotGroup.rotation.x += Math.sin(timestamp * 0.0003) * 0.0008 * dt60;"
    ),
    (
        "    pivotGroup.rotation.x = Math.sin(timestamp * 0.0003) * 0.08;",
        "    // Drift gently from current angle — no snap to fixed position\n    pivotGroup.rotation.x += Math.sin(timestamp * 0.0003) * 0.0008 * dt60;"
    ),
]

fixed = False
for old, new in replacements:
    if old in content:
        content = content.replace(old, new)
        fixed = True
        break

# Also fix the else branch to else if so reduced-motion path isn't broken
content = content.replace(
    "  } else {\n    pivotGroup.rotation.x += (loopState.targetRot.x",
    "  } else if (!isMenuIdle) {\n    pivotGroup.rotation.x += (loopState.targetRot.x"
)

with open(path, 'w') as f:
    f.write(content)

if fixed:
    print("✓ idle rotation drift fixed")
else:
    print("⚠ idle rotation line not found — check src/render/loop.ts manually")
PYEOF

# ── Fix 3: runCountdown — pause-aware so pausing mid-countdown doesn't break game
python3 - << 'PYEOF'
path = 'src/game/runLoop.ts'
with open(path) as f:
    content = f.read()

old = """export async function runCountdown(): Promise<void> {
  return new Promise(async resolve => {
    const countdownEl = document.getElementById('countdown-overlay')!;
    countdownEl.style.opacity = '1';
    for (let i = 3; i > 0; i--) {
      countdownEl.innerText = String(i);
      countdownEl.style.transform = 'translate(-50%, -50%) scale(1.2)';
      playTone('tick');
      await delay(100);
      countdownEl.style.transform = 'translate(-50%, -50%) scale(1)';
      await delay(700);
    }
    countdownEl.innerText = 'GO';
    countdownEl.style.color = 'var(--correct)';
    playTone('go');
    await delay(500);
    countdownEl.style.opacity = '0';
    countdownEl.style.color = 'var(--active)';
    resolve();
  });
}"""

new = """export async function runCountdown(): Promise<void> {
  // Waits for unpause before counting elapsed time — countdown freezes while paused
  async function pauseAwareDelay(ms: number): Promise<void> {
    while (state.isPaused) await delay(50);
    const start = performance.now();
    while (true) {
      await delay(16);
      if (!state.isPaused && performance.now() - start >= ms) break;
    }
  }

  const countdownEl = document.getElementById('countdown-overlay')!;
  countdownEl.style.opacity = '1';
  for (let i = 3; i > 0; i--) {
    while (state.isPaused) await delay(50);
    countdownEl.innerText = String(i);
    countdownEl.style.transform = 'translate(-50%, -50%) scale(1.2)';
    playTone('tick');
    await pauseAwareDelay(100);
    countdownEl.style.transform = 'translate(-50%, -50%) scale(1)';
    await pauseAwareDelay(700);
  }
  while (state.isPaused) await delay(50);
  countdownEl.innerText = 'GO';
  countdownEl.style.color = 'var(--correct)';
  playTone('go');
  await pauseAwareDelay(500);
  countdownEl.style.opacity = '0';
  countdownEl.style.color = 'var(--active)';
}"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("✓ runCountdown pause-aware fix applied")
else:
    print("⚠ runCountdown block not found — check src/game/runLoop.ts manually")
PYEOF

echo ""
echo "Done. Now run:"
echo "  git add -A && git commit -m 'Fix: no rotation snap, pause-safe countdown' && git push"
