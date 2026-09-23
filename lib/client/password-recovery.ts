'use client';

import { createClient, type AuthError } from '@supabase/supabase-js';
import { createPasswordRecovery, INVALID_RESET_LINK, RecoveryVerificationError, type RecoveryLink } from '../logic/password-recovery.ts';
import { getSupabaseBrowserClient } from '../supabase/client.ts';

function verificationError(error: AuthError | null): RecoveryVerificationError {
  if (error?.status === 429) return new RecoveryVerificationError('Too many attempts. Please wait a moment and try again.', false);
  if (error && (!error.status || error.status >= 500)) {
    return new RecoveryVerificationError('Could not verify the link. Check your connection and try again.', false);
  }
  return new RecoveryVerificationError(INVALID_RESET_LINK, true);
}

export function passwordRecoveryForLink(link: RecoveryLink) {
  // Isolate recovery from existing logins; do not persist tokens in cookies/storage.
  const recovery = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { storageKey: 'tamco-password-recovery', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  return createPasswordRecovery(link, {
    verify: async (input) => {
      if (input.kind === 'token') {
        const { data, error } = await recovery.auth.verifyOtp({ type: 'recovery', token_hash: input.tokenHash });
        if (error || !data.session) throw verificationError(error);
      } else if (input.kind === 'implicit') {
        const { error } = await recovery.auth.setSession({ access_token: input.accessToken, refresh_token: input.refreshToken });
        if (error) throw verificationError(error);
      } else {
        // The page strips the code before creating this client, preventing the
        // SSR client from automatically exchanging the same code a second time.
        const { data, error } = await getSupabaseBrowserClient().auth.exchangeCodeForSession(input.code);
        if (error || !data.session) throw verificationError(error);
        const { error: sessionError } = await recovery.auth.setSession({
          access_token: data.session.access_token, refresh_token: data.session.refresh_token,
        });
        if (sessionError) throw verificationError(sessionError);
      }
    },
    update: async (password) => {
      const { error } = await recovery.auth.updateUser({ password });
      if (!error) return { error: null };
      if (error.status === 401 || error.status === 403 || /session|expired|jwt/i.test(error.message)) {
        return { error: INVALID_RESET_LINK, sessionExpired: true };
      }
      if (error.code === 'same_password') return { error: 'Choose a password different from your current password.' };
      if (error.code === 'weak_password') return { error: error.message };
      if (error.status === 429) return { error: 'Too many attempts. Please wait a moment and try again.' };
      return { error: 'Could not update your password. Please try again.' };
    },
    signOut: async () => {
      await recovery.auth.signOut({ scope: 'global' });
      // Clear any old browser login so /login does not skip the new-password sign-in.
      if (typeof window !== 'undefined') {
        await getSupabaseBrowserClient().auth.signOut({ scope: 'local' });
      }
    },
  });
}
