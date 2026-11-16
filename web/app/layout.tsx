import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Vyapar Point',
  description: 'Loyalty points for building-material shops and their karigars',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
