/**
 * verify-attestation — the chokepoint for creating a new leaderboard identity.
 *
 * Why this exists: the anon key ships in the client bundle by design, so every
 * RPC is reachable with curl. Per-player rate limits are therefore decorative on
 * their own — a fresh `crypto.randomUUID()` resets them. Making a NEW identity
 * cost a solved Turnstile challenge is what turns those limits from decorative
 * into binding.
 *
 * Flow:
 *   client → this function { player_id, owner_secret, token }
 *          → Cloudflare siteverify
 *          → claim_identity_attested() via the service role
 *
 * The Cloudflare check MUST happen here and not in the client or in Postgres:
 *  - the client can be edited, so a client-side "verified: true" proves nothing
 *  - Postgres has no synchronous outbound HTTP (pg_net is async), so it cannot
 *    make the siteverify call inline with the claim
 * That leaves an Edge Function holding the secret, which is the standard shape.
 *
 * Deploy:
 *   supabase functions deploy verify-attestation
 *   supabase secrets set TURNSTILE_SECRET_KEY=...
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
 *
 * Testing: Cloudflare publishes keys that always pass or always fail, so this
 * can be exercised end to end without a real challenge.
 *   always passes: secret 1x0000000000000000000000000000000AA
 *   always fails:  secret 2x0000000000000000000000000000000AA
 */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Same shape as the game's own leaderboard calls: never hang forever.
const VERIFY_TIMEOUT_MS = 6000;

const CORS = {
  // The function is called from the game's own origin, but preview deploys and
  // local dev use different ones, so this stays permissive. Nothing here is
  // sensitive to origin: a token is single-use and verified server-side, and the
  // response carries no secret.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  // Fail closed. If this function is reachable but misconfigured, granting
  // identities anyway would silently defeat the gate it exists to enforce.
  if (!secret || !supabaseUrl || !serviceKey) {
    console.error('[verify-attestation] missing required environment');
    return json({ error: 'attestation is not configured' }, 503);
  }

  let body: { player_id?: string; owner_secret?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const { player_id, owner_secret, token } = body;
  if (!player_id || !owner_secret || !token) {
    return json({ error: 'player_id, owner_secret and token are required' }, 400);
  }
  // Validated here as well as in SQL: a malformed id should be a 400 from the
  // edge, not a database error surfaced through the service role.
  if (!UUID_RE.test(player_id) || !UUID_RE.test(owner_secret)) {
    return json({ error: 'player_id and owner_secret must be UUIDs' }, 400);
  }
  if (typeof token !== 'string' || token.length > 2048) {
    return json({ error: 'malformed token' }, 400);
  }

  // ── 1. Ask Cloudflare whether the challenge was really solved ──────────────
  let outcome: { success?: boolean; 'error-codes'?: string[] };
  try {
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    // Binds the token to the caller, so a token solved elsewhere and replayed
    // from another host is rejected.
    const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (ip) form.append('remoteip', ip);

    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    outcome = await res.json();
  } catch (err) {
    // Cloudflare unreachable. Still fail closed, but say so distinctly: this is
    // the case the `require_attestation` kill switch exists for.
    console.error('[verify-attestation] siteverify unreachable:', err);
    return json({ error: 'could not verify challenge, try again' }, 502);
  }

  if (!outcome.success) {
    console.warn('[verify-attestation] rejected:', outcome['error-codes']);
    return json({ error: 'challenge failed' }, 403);
  }

  // ── 2. Claim the identity as the service role ─────────────────────────────
  // anon has no grant on this function, so this is the only route to it.
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_identity_attested`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_player_id: player_id, p_owner_secret: owner_secret }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text();
      // A rate-limit rejection is expected under abuse and is not an error on
      // our side, so it is passed through as 429 rather than flattened to 500.
      const status = detail.includes('rate limit') ? 429 : 500;
      console.error('[verify-attestation] claim failed:', res.status, detail);
      return json({ error: status === 429 ? 'too many requests' : 'could not claim identity' }, status);
    }
  } catch (err) {
    console.error('[verify-attestation] claim unreachable:', err);
    return json({ error: 'could not claim identity' }, 502);
  }

  return json({ ok: true });
});
