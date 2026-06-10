/** @type {import('next').NextConfig} */

// Applied to every response. X-Robots-Tag is the HTTP-header half of the
// no-index requirement (robots.txt + the <meta robots> tag in app/layout.tsx
// are the other two). De-indexing is NOT a security control - every sensitive
// route still requires a valid session (see SECURITY.md).
const securityHeaders = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' },
  // Defense-in-depth hardening headers:
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
