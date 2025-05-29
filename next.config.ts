import type { NextConfig } from 'next';

const child_process = require('child_process');

let commitHash = 'unknown';
try {
  commitHash = child_process.execSync('git rev-parse HEAD').toString().trim();
} catch {
  commitHash = process.env.VERCEL_GIT_COMMIT_SHA || 'unknown';
}

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'i.scdn.co',
        port: '',
        pathname: '/image/**',
      },
    ],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: commitHash,
  },
  async redirects() {
    return [
      {
        source: '/admin/login',
        destination: '/admin',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
