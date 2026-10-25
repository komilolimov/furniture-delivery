import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

let apiOrigin;
try {
  apiOrigin = new URL(process.env.API_ORIGIN ?? 'http://127.0.0.1:3001');
} catch {
  throw new Error('API_ORIGIN must be a valid HTTP(S) origin.');
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
  transpilePackages: ['@furniture-delivery/contracts'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin.origin}/api/:path*` }];
  },
};

export default nextConfig;
