import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  experimental: {
    // Server Actions payloads are small; keep the default 1MB limit explicit.
    serverActions: {
      bodySizeLimit: '2mb',
    },
    // Enables `forbidden()` and the `forbidden.tsx` boundary (Phase 1). Record
    // level denials deliberately use `notFound()` instead, so a guessed id
    // never reveals that the record exists.
    authInterrupts: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          // Authorization checks are server side, so nothing may be cached
          // between users on a shared proxy.
          { key: 'Vary', value: 'Cookie' },
        ],
      },
      {
        // The CSP is deliberately strict: no inline script, no eval, and no
        // object/embed. `'unsafe-inline'` is only present for stylesheets
        // because Next injects the critical CSS at runtime.
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-src 'none'",
              'upgrade-insecure-requests',
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
