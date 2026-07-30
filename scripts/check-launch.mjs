/**
 * Pre-launch gate: fails if any placeholder is still unfilled.
 *
 *   npm run check:launch
 *
 * Deliberately NOT part of CI. It fails by design until launch day — wiring it
 * into CI would mean either a permanently red pipeline or, worse, someone
 * disabling the one check whose whole job is to be noticed.
 *
 * Run it as the last step before going public, and after any edit to the policy
 * pages.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Placeholder → why it matters if it ships unfilled. */
const PLACEHOLDERS = [
  ['YOURDOMAIN.com', 'contact address would not reach anyone'],
  ['[OPERATOR NAME]', 'no identifiable operator — a legal requirement in both documents'],
  ['[JURISDICTION]', 'governing-law clause is unenforceable without one'],
];

const FILES = [
  'public/privacy.html',
  'public/terms.html',
  'LICENSE',
];

let failures = 0;

console.log('Checking launch placeholders…\n');

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.log(`  ?  ${rel} — missing`);
    failures++;
    continue;
  }
  const text = fs.readFileSync(abs, 'utf8');
  const hits = PLACEHOLDERS.filter(([token]) => text.includes(token));

  if (hits.length === 0) {
    console.log(`  ok ${rel}`);
    continue;
  }
  failures += hits.length;
  console.log(`  !  ${rel}`);
  for (const [token, why] of hits) {
    const count = text.split(token).length - 1;
    console.log(`       ${token}  ×${count}  — ${why}`);
  }
}

// The dates are a judgement call rather than a token match, so they are a
// reminder rather than a hard failure.
console.log('\nAlso confirm by hand:');
console.log('  · the "Last updated" date in privacy.html and terms.html');
console.log('  · the privacy@ mailbox exists and you have received a test message');
console.log('  · VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set on the host');

if (failures > 0) {
  console.error(`\nFAIL — ${failures} placeholder(s) still unfilled. Not ready to launch.`);
  process.exit(1);
}

console.log('\nPASS — no placeholders remain.');
