import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './tailwind.css';

export const metadata: Metadata = {
  title: 'Furniture Delivery',
  description: 'Furniture delivery and home assembly workspace. Service connection status.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
