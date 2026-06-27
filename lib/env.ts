// =============================================================================
// Centralized environment access. Server-only secrets are read through getters
// that throw a clear error if missing AT CALL TIME (not import time, so the app
// can still build without secrets present). Never import the SERVER_* getters
// from a client component.
// =============================================================================

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : fallback;
}

// --- Public (safe to expose to the browser) ----------------------------------
export const PUBLIC_ENV = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  cloudinaryCloudName: () => required('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME'),
  appUrl: () => optional('NEXT_PUBLIC_APP_URL', 'http://localhost:3000').replace(/\/+$/, ''),
};

// --- Server-only secrets -----------------------------------------------------
export const SERVER_ENV = {
  supabaseServiceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
  cloudinaryApiKey: () => required('CLOUDINARY_API_KEY'),
  cloudinaryApiSecret: () => required('CLOUDINARY_API_SECRET'),
  emailProvider: () => {
    const explicit = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
    if (explicit === 'brevo' || explicit === 'resend') return explicit;
    return process.env.BREVO_API_KEY?.trim() ? 'brevo' : 'resend';
  },
  brevoApiKey: () => required('BREVO_API_KEY'),
  resendApiKey: () => required('RESEND_API_KEY'),
  reminderFromEmail: () => optional('REMINDER_FROM_EMAIL', 'First Aid Reminders <onboarding@resend.dev>'),
  adminNotificationEmail: () => process.env.ADMIN_NOTIFICATION_EMAIL?.trim() || null,
  cronSecret: () => required('CRON_SECRET'),
  ipHashSalt: () => required('IP_HASH_SALT'),
  publicUsageEnabled: () => optional('PUBLIC_USAGE_SUBMISSION_ENABLED', 'true') === 'true',
  usageRateLimitPerIpPerHour: () => Number(optional('USAGE_RATE_LIMIT_PER_IP_PER_HOUR', '10')),
  usageRateLimitGlobalPerHour: () => Number(optional('USAGE_RATE_LIMIT_GLOBAL_PER_HOUR', '120')),
};
