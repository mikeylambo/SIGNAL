#!/bin/bash
# Run from SIGNAL project root — fixes TS1128 syntax error in loop.ts

python3 - << 'PYEOF'
path = 'src/render/loop.ts'
with open(path) as f:
    content = f.read()

# The bare { } block is invalid TS — replace with a plain const + two lines
old = """  // Grid stays wherever the player left it — targetRot only changes on drag.
  {
    const rotLerp = 1 - Math.pow(1 - 0.1, dt60);
    pivotGroup.rotation.x += (loopState.targetRot.x - pivotGroup.rotation.x) * rotLerp;
    pivotGroup.rotation.y += (loopState.targetRot.y - pivotGroup.rotation.y) * rotLerp;
  }"""

new = """  // Grid stays wherever the player left it — targetRot only changes on drag.
  const rotLerp = 1 - Math.pow(1 - 0.1, dt60);
  pivotGroup.rotation.x += (loopState.targetRot.x - pivotGroup.rotation.x) * rotLerp;
  pivotGroup.rotation.y += (loopState.targetRot.y - pivotGroup.rotation.y) * rotLerp;"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("✓ loop.ts: TS1128 syntax error fixed")
else:
    print("⚠ Block not found — printing lines 70-85:")
    for i, line in enumerate(content.split('\n')[69:85], 70):
        print(f"  {i}: {line}")
PYEOF

echo ""
echo "Run: git add -A && git commit -m 'Fix: TS1128 syntax error in loop.ts' && git push"
