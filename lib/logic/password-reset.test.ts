import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordReset } from './password-reset.ts';

test('accepts a valid matching password', () => {
  assert.equal(validatePasswordReset('FreshPass2026', 'FreshPass2026'), null);
});

test('rejects short passwords', () => {
  assert.equal(validatePasswordReset('short', 'short'), 'Password must be at least 8 characters.');
});

test('rejects mismatched passwords', () => {
  assert.equal(validatePasswordReset('FreshPass2026', 'FreshPass2027'), 'Passwords do not match.');
});

test('rejects spaces', () => {
  assert.equal(validatePasswordReset('Fresh Pass 2026', 'Fresh Pass 2026'), 'Password cannot contain spaces.');
});
