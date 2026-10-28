import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

let apiOrigin;
try {
  apiOrigin = new URL(process.env.API_ORIGIN ?? 'http://127.0.0.1:3001');
} catch {
  throw new Error('API_ORIGIN must be a valid HTTP(S) origin.');
}

// Owned demo/test builds must not share the ordinary development output directory.
const isolatedDist = process.env.FD_NEXT_DIST_DIR;
if (
  isolatedDist !== undefined &&
  !/^\.next-(?:test|demo)\/[a-z0-9][a-z0-9_-]{0,79}$/.test(isolatedDist)
) {
  throw new Error('FD_NEXT_DIST_DIR must name one safe owned demo/test build directory.');
}
if (
  !['http:', 'https:'].includes(apiOrigin.protocol) ||
  apiOrigin.username ||
  apiOrigin.password ||
  apiOrigin.pathname !== '/' ||
  apiOrigin.search ||
  apiOrigin.hash
) {
  throw new Error(
    'API_ORIGIN must be an HTTP(S) origin without credentials, path, query, or fragment.',
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  poweredByHeader: false,
  ...(isolatedDist ? { distDir: isolatedDist } : {}),
  transpilePackages: ['@furniture-delivery/contracts'],
  // 20 MiB PDF + multipart metadata. Nest enforces the smaller per-format limits.
  experimental: { proxyClientMaxBodySize: 22 * 1024 * 1024 },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin.origin}/api/:path*` }];
  },
};

export default nextConfig;
