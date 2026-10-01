import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * The CSP deliberately omits `default-src` and `script-src`. A production React
 * app ships inline bootstrap scripts and a nonce has to be threaded through the
 * render to allow them, which is a larger change than a header list; setting
 * `default-src 'self'` here would block the application's own bundle and break
 * hydration. The directives below are the ones that can be enforced safely
 * without one, and `frame-ancestors` supersedes the legacy `X-Frame-Options`.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
    ].join('; '),
  },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;