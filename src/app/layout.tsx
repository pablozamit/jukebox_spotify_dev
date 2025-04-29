import type { Metadata } from 'next';
// Removed Geist font import as it's not installed
// import { GeistSans } from 'geist/font/sans';
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';

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
        // Removed Geist font variable usage
        // className={cn(
        //   "min-h-screen bg-background font-sans antialiased",
        //   GeistSans.variable
        // )}
        className={cn(
          "min-h-screen bg-background font-sans antialiased"
        )}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
