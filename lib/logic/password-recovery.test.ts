import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordRecovery, parseRecoveryLink, RecoveryVerificationError, type RecoveryOperations } from './password-recovery.ts';
import { buildPasswordResetEmail } from './password-reset-email.ts';
import { requestPasswordReset, type ResetRequestDependencies } from './password-reset-request.ts';

const origin = 'https://first-aid-box-inspection.vercel.app';
const link = { kind: 'token' as const, tokenHash: 'test-one-time-token' };

function requestDeps(overrides: Partial<ResetRequestDependencies> = {}): ResetRequestDependencies {
  return {
    claim: async () => 0,
    generate: async (email) => ({ tokenHash: link.tokenHash, userId: 'test-user', email }),
    isActive: async () => true,
    send: async () => ({ ok: true }),
    ...overrides,
  };
}

function operations(overrides: Partial<RecoveryOperations> = {}): RecoveryOperations {
  return { verify: async () => {}, update: async () => ({ error: null }), signOut: async () => {}, ...overrides };
}

test('mock request and one-time recovery lifecycle across independent clients', async () => {
  let message = '';
  let currentPassword = 'OldPassword123';
  let tokenUsed = false;
  const result = await requestPasswordReset(' Test@Example.com ', origin, requestDeps({
    send: async (mail) => {
      assert.deepEqual(mail.to, ['test@example.com']);
      message = mail.text;
      return { ok: true };
    },
  }));
  assert.equal(result.status, 200);
  const emailedLink = message.match(/https:\/\/\S+/)?.[0];
  assert.ok(emailedLink);
  const parsed = parseRecoveryLink(emailedLink);
  assert.deepEqual(parsed, link);
  const deps = operations({
    verify: async (input) => {
      assert.deepEqual(input, link);
      if (tokenUsed) throw new RecoveryVerificationError('expired', true);
      tokenUsed = true;
    },
    update: async (password) => { currentPassword = password; return { error: null }; },
  });
  createPasswordRecovery(parsed, deps); // Scanner visits but never submits a password.
  assert.equal(tokenUsed, false);
  const resetInAnotherBrowser = createPasswordRecovery(parsed, deps);
  assert.equal((await resetInAnotherBrowser('NewPassword123')).ok, true);
  assert.equal(currentPassword, 'NewPassword123');
  assert.notEqual(currentPassword, 'OldPassword123');
  assert.equal((await createPasswordRecovery(parsed, deps)('AnotherPassword123')).invalid, true);
});

test('email puts token only in the fragment and HTML-escapes the link', () => {
  const email = buildPasswordResetEmail(origin, 'token&<test>');
  const url = new URL(email.text.match(/https:\/\/\S+/)![0]);
  assert.equal(url.search, '');
  assert.equal(url.pathname, '/reset-password');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('token_hash'), 'token&<test>');
  assert.ok(email.html.includes('&amp;type=recovery'));
  assert.ok(!email.html.includes('<test>'));
});

test('unknown and inactive accounts give the same response without sending email', async () => {
  const neverSend = async () => { assert.fail('Must not send'); };
  const unknown = await requestPasswordReset('unknown@example.com', origin, requestDeps({ generate: async () => null, send: neverSend }));
  const inactive = await requestPasswordReset('inactive@example.com', origin, requestDeps({ isActive: async () => false, send: neverSend }));
  assert.deepEqual(unknown, inactive);
  assert.equal(unknown.status, 200);
});

test('rate limit runs before generating a new link so retries do not invalidate emails', async () => {
  const result = await requestPasswordReset('test@example.com', origin, requestDeps({
    claim: async () => 1800,
    generate: async () => { assert.fail('Must not replace the token'); },
  }));
  assert.deepEqual(result, { status: 429, retryAfter: 1800 });
});

test('provider failure does not claim email was sent', async () => {
  await assert.rejects(requestPasswordReset('test@example.com', origin, requestDeps({ send: async () => ({ ok: false }) })), /reset_delivery_failed/);
});

test('limiter failure fails closed without sending mail', async () => {
  await assert.rejects(requestPasswordReset('test@example.com', origin, requestDeps({
    claim: async () => { throw new Error('database unavailable'); },
    send: async () => { assert.fail('Must not send'); },
  })), /database unavailable/);
});

test('missing links and non-recovery links cannot use an existing login', async () => {
  for (const href of [origin + '/reset-password', origin + '/reset-password#token_hash=abc&type=invite', origin + '/reset-password#error_code=otp_expired', origin + '/reset-password#access_token=a&refresh_token=b']) {
    const parsed = parseRecoveryLink(href);
    assert.equal(parsed.kind, 'invalid');
    const reset = createPasswordRecovery(parsed, operations({ update: async () => { assert.fail('Must not update'); } }));
    assert.equal((await reset('NewPassword123')).invalid, true);
  }
});

test('supports legacy query token, code and implicit recovery links', () => {
  assert.deepEqual(parseRecoveryLink(origin + '/reset-password?token_hash=abc&type=recovery'), { kind: 'token', tokenHash: 'abc' });
  assert.deepEqual(parseRecoveryLink(origin + '/reset-password?code=abc'), { kind: 'code', code: 'abc' });
  assert.deepEqual(parseRecoveryLink(origin + '/reset-password#access_token=a&refresh_token=b&type=recovery'), { kind: 'implicit', accessToken: 'a', refreshToken: 'b' });
});

test('expired link never reaches password update', async () => {
  const reset = createPasswordRecovery(link, operations({
    verify: async () => { throw new RecoveryVerificationError('expired', true); },
    update: async () => { assert.fail('Must not update'); },
  }));
  assert.equal((await reset('NewPassword123')).invalid, true);
});

test('password policy retry reuses the verified session instead of consuming the token again', async () => {
  let verifies = 0;
  let updates = 0;
  const reset = createPasswordRecovery(link, operations({
    verify: async () => { verifies++; },
    update: async () => ({ error: ++updates === 1 ? 'Choose a different password.' : null }),
  }));
  assert.equal((await reset('OldPassword123')).ok, false);
  assert.equal((await reset('NewPassword123')).ok, true);
  assert.equal(verifies, 1);
});

test('double submit consumes one token and updates once', async () => {
  let verifies = 0;
  let updates = 0;
  const reset = createPasswordRecovery(link, operations({
    verify: async () => { verifies++; },
    update: async () => { updates++; return { error: null }; },
  }));
  const results = await Promise.all([reset('NewPassword123'), reset('NewPassword123')]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(verifies, 1);
  assert.equal(updates, 1);
  assert.equal((await reset('AnotherPassword123')).invalid, true);
});

test('network failure clears busy state and allows retry with the verified session', async () => {
  let updates = 0;
  const reset = createPasswordRecovery(link, operations({ update: async () => {
    if (++updates === 1) throw new Error('network error');
    return { error: null };
  } }));
  assert.equal((await reset('NewPassword123')).ok, false);
  assert.equal((await reset('NewPassword123')).ok, true);
});

test('verification network failure does not incorrectly report an expired link', async () => {
  let attempts = 0;
  const reset = createPasswordRecovery(link, operations({ verify: async () => {
    if (++attempts === 1) throw new Error('network unavailable');
  } }));
  const first = await reset('NewPassword123');
  assert.equal(first.ok, false);
  assert.ok(!first.invalid);
  assert.equal((await reset('NewPassword123')).ok, true);
});

test('sign-out failure cannot turn a successful password update into a failure', async () => {
  const reset = createPasswordRecovery(link, operations({ signOut: async () => { throw new Error('network error'); } }));
  assert.equal((await reset('NewPassword123')).ok, true);
});
