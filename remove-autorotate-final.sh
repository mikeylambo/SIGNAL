#!/bin/bash
# Run from SIGNAL project root
# Removes ALL auto-rotation. Grid is stationary. Manual drag still works.

python3 - << 'PYEOF'
import re

# ── 1. loop.ts — remove auto-rotation, keep smooth drag lerp ──────────────────
path = 'src/render/loop.ts'
with open(path) as f:
    content = f.read()

# Step 1a: initial targetRot — set to 0,0 so no lerp pull on load
content = content.replace(
    "targetRot: { x: Math.PI / 6, y: -Math.PI / 8 },",
    "targetRot: { x: 0, y: 0 },  // only the drag handler updates this"
)

# Step 1b: remove isMenuIdle block entirely, replace rotation section with clean lerp
# Handle all known variants with a regex
import re
pattern = re.compile(
    r"  const rotLerp[^\n]*\n"
    r"  const isMenuIdle[^\n]*\n"
    r"(?:.*\n)*?"   # any lines in between
    r"  \}\n",      # closing brace of the if/else
    re.MULTILINE
)

clean_block = (
    "  // Grid stays wherever the player left it — targetRot only changes on drag.\n"
    "  {\n"
    "    const rotLerp = 1 - Math.pow(1 - 0.1, dt60);\n"
    "    pivotGroup.rotation.x += (loopState.targetRot.x - pivotGroup.rotation.x) * rotLerp;\n"
    "    pivotGroup.rotation.y += (loopState.targetRot.y - pivotGroup.rotation.y) * rotLerp;\n"
    "  }\n"
)

# Find the block manually between rotLerp and the end of the if/else
start = content.find("  const rotLerp = 1 - Math.pow(1 - 0.1, dt60);")
if start == -1:
    print("⚠ rotLerp line not found in loop.ts")
else:
    # Find the closing brace of the if/else block after isMenuIdle
    search_from = content.find("  const isMenuIdle", start)
    if search_from == -1:
        # isMenuIdle already removed, just check if there's a stale auto-rotate
        print("  isMenuIdle not found — checking for stale rotation lines")
        for bad in [
            "pivotGroup.rotation.y += 0.003",
            "pivotGroup.rotation.x = Math.sin",
            "pivotGroup.rotation.x += Math.sin",
        ]:
            if bad in content:
                print(f"  ⚠ Found stale line: {bad!r} — remove manually")
    else:
        # Find the end of this if/else block
        brace_depth = 0
        i = search_from
        block_start = start
        in_block = False
        for i in range(search_from, len(content)):
            if content[i] == '{':
                brace_depth += 1
                in_block = True
            elif content[i] == '}':
                brace_depth -= 1
                if in_block and brace_depth == 0:
                    block_end = i + 1
                    # consume trailing newline
                    if block_end < len(content) and content[block_end] == '\n':
                        block_end += 1
                    break

        old_block = content[block_start:block_end]
        content = content[:block_start] + clean_block + content[block_end:]
        print("✓ loop.ts: auto-rotation removed, clean lerp installed")

with open(path, 'w') as f:
    f.write(content)


# ── 2. runLoop.ts — remove all hardcoded targetRot resets ────────────────────
path = 'src/game/runLoop.ts'
with open(path) as f:
    content = f.read()

removed = 0
for variant in [
    "  loopState.targetRot = { x: Math.PI / 6, y: -Math.PI / 8 };\n",
    "  loopState.targetRot = { x: Math.PI / 6, y: -Math.PI / 8 };\r\n",
]:
    n = content.count(variant)
    if n:
        content = content.replace(variant, "")
        removed += n

with open(path, 'w') as f:
    f.write(content)

if removed:
    print(f"✓ runLoop.ts: removed {removed} hardcoded targetRot reset(s)")
else:
    print("  runLoop.ts: no targetRot resets found (already clean)")


# ── 3. Verify input.ts still updates targetRot on drag (should be untouched) ──
path = 'src/input.ts'
try:
    with open(path) as f:
        inp = f.read()
    if 'targetRot' in inp:
        print("✓ input.ts: drag handler still updates targetRot (good)")
    else:
        print("⚠ input.ts: targetRot not found — drag rotation may be broken")
except FileNotFoundError:
    print("  input.ts not found at src/input.ts — skipping check")

PYEOF

echo ""
echo "Run: git add -A && git commit -m 'Fix: grid fully stationary, no auto-rotate or snap' && git push"
