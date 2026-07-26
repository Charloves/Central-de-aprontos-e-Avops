import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Central Operacional V2',
  description: 'Portal operacional para AVOPs, Aprontos e OI.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
