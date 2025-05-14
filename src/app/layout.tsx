import type { Metadata } from 'next';
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'Bar Jukebox',
  description: 'Queue up songs at the bar!',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased"
        )}
      >
        {children}
        <Toaster />

        {/* Carga el script de Spotify Web Playback SDK */}
        <Script
          src="https://sdk.scdn.co/spotify-player.js"
          strategy="afterInteractive" // Cargar después de que la página sea interactiva
        />
      </body>
    </html>
  );
}
