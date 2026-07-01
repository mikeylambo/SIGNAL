#!/bin/bash
# Run from SIGNAL project root
# Removes auto-rotation on menu — grid stays still, manual drag still works

python3 - << 'PYEOF'
path = 'src/render/loop.ts'
with open(path) as f:
    content = f.read()

# Remove the entire isMenuIdle auto-rotate block, replace with nothing
# (the else-if becomes the only branch, handling drag/gameplay rotation)
replacements = [
    # Variant A: with drift comment
    (
        """  if (isMenuIdle && !reducedMotion) {
    // Gentle drift from wherever the board already is — no snap-back to a fixed angle
    pivotGroup.rotation.y += 0.003 * dt60;
    pivotGroup.rotation.x += Math.sin(timestamp * 0.0003) * 0.0008 * dt60;
  } else if (!isMenuIdle) {""",
        "  if (!isMenuIdle) {"
    ),
    # Variant B: with drift comment, original else
    (
        """  if (isMenuIdle && !reducedMotion) {
    // Drift gently from current angle — no snap to fixed position
    pivotGroup.rotation.y += 0.003 * dt60;
    pivotGroup.rotation.x += Math.sin(timestamp * 0.0003) * 0.0008 * dt60;
  } else if (!isMenuIdle) {""",
        "  if (!isMenuIdle) {"
    ),
    # Variant C: original code from repo (PI/6 version)
    (
        """  if (isMenuIdle && !reducedMotion) {
    pivotGroup.rotation.y += 0.003 * dt60;
    pivotGroup.rotation.x = Math.PI / 6 + Math.sin(timestamp * 0.0003) * 0.08;
  } else {""",
        "  if (!isMenuIdle) {"
    ),
    # Variant D: original code no PI/6
    (
        """  if (isMenuIdle && !reducedMotion) {
    pivotGroup.rotation.y += 0.003 * dt60;
    pivotGroup.rotation.x = Math.sin(timestamp * 0.0003) * 0.08;
  } else {""",
        "  if (!isMenuIdle) {"
    ),
]

fixed = False
for old, new in replacements:
    if old in content:
        content = content.replace(old, new)
        fixed = True
        print(f"✓ Auto-rotation removed (matched variant)")
        break

if not fixed:
    # Show context so we can debug
    idx = content.find('isMenuIdle')
    print(f"⚠ Could not match — showing current block:")
    print(content[max(0,idx-20):idx+300])
else:
    with open(path, 'w') as f:
        f.write(content)

PYEOF

echo ""
echo "Done. Run:"
echo "  git add -A && git commit -m 'Remove grid auto-rotation, keep manual drag' && git push"
