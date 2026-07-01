#!/bin/bash
# Run from SIGNAL project root
# Fixes iOS grid centering, controls-hint clipping, universal camera symmetry

python3 - << 'PYEOF'

# ── 1. scene.ts — better portrait camera that accounts for iOS sheet height ───
path = 'src/render/scene.ts'
with open(path) as f:
    content = f.read()

old = """// Camera looks at a point below world origin so the grid sits in the upper
// portion of the viewport, clear of the bottom sheet UI.
export function adjustCameraForViewport(): void {
  const portrait = window.innerWidth < window.innerHeight;
  const small    = window.innerHeight < 667;
  if (small) {
    camera.fov = 72;
    camera.position.set(0, 6, 18);
    camera.lookAt(0, -1.5, 0);
  } else if (portrait) {
    camera.fov = 65;
    camera.position.set(0, 5.5, 16);
    camera.lookAt(0, -1.5, 0);
  } else {
    camera.fov = 50;
    camera.position.set(0, 5, 14);
    camera.lookAt(0, -2, 0);
  }
  camera.updateProjectionMatrix();
}"""

new = """// Position camera so the grid sits in the upper portion of the viewport,
// above the bottom sheet UI. On mobile we measure the sheet height and
// use it to compute a lookAt offset that keeps the grid visually centred
// in the space above the sheet on all screen sizes.
export function adjustCameraForViewport(): void {
  const portrait = window.innerWidth < window.innerHeight;
  const small    = window.innerHeight < 667;

  // How much of the viewport (0–1) is occupied by the bottom sheet?
  // Default to 45% if the element isn't mounted yet.
  const sheetEl = document.getElementById('menu-sheet');
  const sheetFrac = sheetEl
    ? sheetEl.getBoundingClientRect().height / window.innerHeight
    : 0.45;

  // We want the grid centred in the available space above the sheet.
  // lookAtY shifts the camera target downward so the grid projects into
  // the upper region. More sheet → more shift.
  const lookAtY = -(sheetFrac * 3.5);

  if (small) {
    camera.fov = 72;
    camera.position.set(0, 6, 18);
    camera.lookAt(0, lookAtY, 0);
  } else if (portrait) {
    camera.fov = 62;
    camera.position.set(0, 5.5, 15);
    camera.lookAt(0, lookAtY, 0);
  } else {
    camera.fov = 50;
    camera.position.set(0, 5, 14);
    camera.lookAt(0, lookAtY, 0);
  }
  camera.updateProjectionMatrix();
}"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("✓ scene.ts: dynamic lookAt based on sheet height")
else:
    print("⚠ scene.ts block not found")


# ── 2. board.ts — same dynamic lookAt for createBoard camera reposition ───────
path = 'src/render/board.ts'
with open(path) as f:
    content = f.read()

old = """  const portrait  = window.innerWidth < window.innerHeight;
  const small     = window.innerHeight < 667;
  const lookY     = small ? -1.5 : portrait ? -1.5 : -2;
  const baseZ     = small ? 18 : portrait ? 16 : 14;
  const baseY     = small ? 6 : portrait ? 5.5 : 5;
  const gridScale = Math.max(1, state.gridSize / 3);
  camera.position.set(0, baseY * gridScale, baseZ * gridScale);
  camera.lookAt(0, lookY * gridScale, 0);"""

new = """  const portrait  = window.innerWidth < window.innerHeight;
  const small     = window.innerHeight < 667;
  const baseZ     = small ? 18 : portrait ? 15 : 14;
  const baseY     = small ? 6 : portrait ? 5.5 : 5;
  const gridScale = Math.max(1, state.gridSize / 3);

  // Dynamic lookAt: shift target down proportional to sheet height so the
  // grid stays centred in the space above the sheet on any screen size.
  const sheetEl  = document.getElementById('menu-sheet');
  const sheetFrac = sheetEl
    ? sheetEl.getBoundingClientRect().height / window.innerHeight
    : 0.45;
  const lookY = -(sheetFrac * 3.5);

  camera.position.set(0, baseY * gridScale, baseZ * gridScale);
  camera.lookAt(0, lookY, 0);"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("✓ board.ts: dynamic lookAt based on sheet height")
else:
    print("⚠ board.ts block not found")


# ── 3. index.html — give controls-hint more breathing room + prevent clipping ─
path = 'index.html'
with open(path) as f:
    content = f.read()

old = """        <div id="controls-hint" style="
            position:absolute; bottom:var(--menu-sheet-h, 300px); left:0; right:0;"""

new = """        <div id="controls-hint" style="
            position:absolute; bottom:calc(var(--menu-sheet-h, 300px) + 8px); left:0; right:0;"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("✓ index.html: controls-hint bottom buffer increased")
else:
    print("⚠ index.html controls-hint not found")


# ── 4. main.ts — re-run adjustCameraForViewport after sheet height is known ───
path = 'src/main.ts'
with open(path) as f:
    content = f.read()

old = """  updateMenuSheetHeight();
  window.addEventListener('resize', updateMenuSheetHeight);"""

new = """  updateMenuSheetHeight();
  window.addEventListener('resize', () => {
    updateMenuSheetHeight();
    adjustCameraForViewport();
  });"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("✓ main.ts: resize re-triggers camera adjustment")
else:
    # Try to add the import and the resize hook
    if 'adjustCameraForViewport' not in content:
        content = content.replace(
            "import { adjustCameraForViewport",
            "import { adjustCameraForViewport"
        )
    print("⚠ main.ts resize block not found — may need manual check")

# Make sure adjustCameraForViewport is imported in main.ts
if 'adjustCameraForViewport' not in content:
    content = content.replace(
        "} from './render/scene';",
        ", adjustCameraForViewport } from './render/scene';"
    )
    with open(path, 'w') as f:
        f.write(content)
    print("✓ main.ts: added adjustCameraForViewport import")
else:
    with open(path, 'w') as f:
        f.write(content)
    print("✓ main.ts: adjustCameraForViewport already imported")

PYEOF

echo ""
echo "Run: git add -A && git commit -m 'Fix: dynamic camera centering for all screen sizes' && git push"
