export type RecoveryLink =
  | { kind: 'token'; tokenHash: string }
  | { kind: 'implicit'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'invalid' };

export const INVALID_RESET_LINK = 'This reset link is invalid, expired, or already used. Please request a new one.';

export class RecoveryVerificationError extends Error {
  invalid: boolean;
  constructor(message: string, invalid: boolean) {
    super(message);
    this.invalid = invalid;
  }
}

export function parseRecoveryLink(href: string): RecoveryLink {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const get = (key: string) => fragment.get(key) ?? url.searchParams.get(key);
  if (get('error') || get('error_code') || get('error_description')) return { kind: 'invalid' };
  const type = get('type');
  if (type && type !== 'recovery') return { kind: 'invalid' };
  const tokenHash = get('token_hash');
  if (tokenHash) return { kind: 'token', tokenHash };
  const code = url.searchParams.get('code');
  if (code) return { kind: 'code', code };
  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  if (type === 'recovery' && accessToken && refreshToken) return { kind: 'implicit', accessToken, refreshToken };
  return { kind: 'invalid' };
}

export interface RecoveryOperations {
  verify: (link: Exclude<RecoveryLink, { kind: 'invalid' }>) => Promise<void>;
  update: (password: string) => Promise<{ error: string | null; sessionExpired?: boolean }>;
  signOut: () => Promise<void>;
}

// Verify on submission, never on page load. Retain the session on password-policy
// failures so the user can correct their password without consuming another link.
export function createPasswordRecovery(link: RecoveryLink, operations: RecoveryOperations) {
  let verified = false;
  let saved = false;
  let running = false;
  return async (password: string): Promise<{ ok: boolean; invalid?: boolean; error?: string }> => {
    if (running) return { ok: false, error: 'A password update is already in progress.' };
    if (saved || link.kind === 'invalid') return { ok: false, invalid: true, error: INVALID_RESET_LINK };
    running = true;
    try {
      if (!verified) {
        try { await operations.verify(link); } catch (error) {
          return error instanceof RecoveryVerificationError
            ? { ok: false, invalid: error.invalid, error: error.message }
            : { ok: false, error: 'Could not verify the link. Check your connection and try again.' };
        }
        verified = true;
      }
      const result = await operations.update(password);
      if (result.error) return { ok: false, invalid: result.sessionExpired, error: result.error };
      saved = true;
      // A failed sign-out must not misreport a password that was successfully changed.
      try { await operations.signOut(); } catch { /* Recovery client is memory-only. */ }
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not update your password. Check your connection and try again.' };
    } finally {
      running = false;
    }
  };
}
