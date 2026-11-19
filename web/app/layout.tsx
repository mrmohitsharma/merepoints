import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Mere Points',
  description: 'Loyalty points for building-material shops and their Site Experts',
  metadataBase: new URL('https://merepoints.in'),
  openGraph: { title: 'Mere Points', description: 'Loyalty points for building-material shops and their Site Experts', images: ['/brand/icon-512.png'] },
  manifest: '/manifest.webmanifest',
};
export const viewport = { themeColor: '#F4AA04' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
