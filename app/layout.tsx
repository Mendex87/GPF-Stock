import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GPF Cloud',
  description: 'Gestion cloud de stock para GPF Mangueras Hidraulicas',
  icons: {
    icon: '/brand/app-icon.png',
    apple: '/brand/app-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#071013',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
