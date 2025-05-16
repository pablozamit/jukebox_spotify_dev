import type { NextConfig } from 'next';
import fs from 'fs'; // Usamos import de ES Module si el entorno lo permite
import path from 'path'; // Usamos import de ES Module

const child_process = require('child_process'); // Mantenemos require para child_process

let commitHash = 'unknown';
try {
  commitHash = child_process.execSync('git rev-parse HEAD').toString().trim();
} catch {
  // En el entorno de Vercel, git rev-parse HEAD puede fallar si no es un repo git completo.
  // Vercel provee VERCEL_GIT_COMMIT_SHA.
  commitHash = process.env.VERCEL_GIT_COMMIT_SHA || 'local-build-no-git-fallback';
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
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_APP_VERSION: commitHash,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_DATABASE_URL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  },
  // --- AÑADIDO PARA DEPURACIÓN ---
  webpack: (config, { isServer, buildId, dev }) => {
    // Solo ejecutar esto durante el build en el servidor, y no en desarrollo local para evitar spam
    if (isServer && !dev) {
      try {
        // process.cwd() da el directorio raíz del proyecto
        const filePath = path.resolve(process.cwd(), 'src/app/api/spotify/sync/route.ts');
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          console.log(`\n\n--- DEBUG: CONTENT OF src/app/api/spotify/sync/route.ts (Build ID: ${buildId}) ---`);
          // Imprime una porción del archivo para no saturar los logs
          console.log(fileContent.substring(0, 1200)); // Aumentado a 1200 caracteres
          if (fileContent.length > 1200) {
            console.log(`\n... (file content truncated, total length: ${fileContent.length} characters) ...`);
          }
          console.log('--- DEBUG: END OF CONTENT ---\n\n');
        } else {
          console.log(`\n\n--- DEBUG: File NOT FOUND src/app/api/spotify/sync/route.ts (Build ID: ${buildId}) ---\n\n`);
        }
      } catch (error: any) {
        console.error('\n\n--- DEBUG: ERROR READING src/app/api/spotify/sync/route.ts ---');
        console.error(error.message);
        console.log('--- DEBUG: END OF ERROR ---\n\n');
      }
    }
    return config;
  },
  // --- FIN DE AÑADIDO PARA DEPURACIÓN ---
};

export default nextConfig;