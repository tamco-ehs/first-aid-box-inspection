import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { passwordRecoveryForLink } from '../client/password-recovery.ts';

const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', email: 'reset-test@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const jwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${payload}.dGVzdA`;
const session = { access_token: jwt, refresh_token: 'local-test-refresh', expires_in: 3600, token_type: 'bearer', user };
const authHeaders = { 'x-supabase-api-version': '2024-01-01' };

// These exercise the real Supabase SDK and the application's browser adapter.
// HTTP responses are simulated: no production account or email is touched.
test('real SDK adapter: verify once, retry rejected password, save, sign out, sign in with new password', async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://reset-test.example';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'local-test-anon';
  let currentPassword = 'OldPassword123';
  let tokenUsed = false;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push(`${init?.method} ${url.pathname}`);
    if (url.pathname.endsWith('/verify')) {
      assert.equal(body.type, 'recovery');
      assert.equal(body.token_hash, 'one-time-token');
      if (tokenUsed) return Response.json({ code: 'otp_expired', msg: 'Token has expired or is invalid' }, { status: 403, headers: authHeaders });
      tokenUsed = true;
      return Response.json(session);
    }
    if (url.pathname.endsWith('/user') && init?.method === 'PUT') {
      assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${jwt}`);
      if (body.password === currentPassword) return Response.json({ code: 'same_password', msg: 'New password should be different from the old password.' }, { status: 422, headers: authHeaders });
      currentPassword = body.password;
      return Response.json({ user });
    }
    if (url.pathname.endsWith('/logout')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/token')) {
      assert.equal(url.searchParams.get('grant_type'), 'password');
      return body.password === currentPassword ? Response.json(session) : Response.json({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, { status: 400 });
    }
    throw new Error(`Unexpected auth request: ${url.pathname}`);
  });
  const recovery = passwordRecoveryForLink({ kind: 'token', tokenHash: 'one-time-token' });
  assert.equal(calls.length, 0);
  const rejected = await recovery(currentPassword);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error!, /different/);
  assert.equal((await recovery('NewPassword123')).ok, true);
  assert.equal(calls.filter((v) => v.includes('/verify')).length, 1);
  assert.ok(calls.includes('POST /auth/v1/logout'));
  const fresh = createClient('https://reset-test.example', 'local-test-anon', { auth: { persistSession: false, autoRefreshToken: false } });
  assert.ok((await fresh.auth.signInWithPassword({ email: user.email, password: 'OldPassword123' })).error);
  assert.equal((await fresh.auth.signInWithPassword({ email: user.email, password: 'NewPassword123' })).error, null);
  const reused = passwordRecoveryForLink({ kind: 'token', tokenHash: 'one-time-token' });
  assert.equal((await reused('AnotherPassword123')).invalid, true);
});

test('real SDK adapter reports verification rate limits as retryable', async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://reset-test.example';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'local-test-anon';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'over_request_rate_limit', msg: 'Too many requests' }, { status: 429 }));
  const reset = passwordRecoveryForLink({ kind: 'token', tokenHash: 'test-token' });
  const result = await reset('NewPassword123');
  assert.equal(result.ok, false);
  assert.equal(result.invalid, false);
  assert.match(result.error!, /wait/);
});
