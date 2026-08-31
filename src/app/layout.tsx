import type { Metadata } from 'next';
import { Inter, Sora } from 'next/font/google';

import './globals.css';

// Locked typography: Inter for UI/body text, Sora for headings, display and
// numeric emphasis. next/font self-hosts both families and generates metric-
// compatible fallbacks, so there is no layout shift and no client-side font
// handling. The variables are consumed by globals.css (@theme inline).
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const sora = Sora({
  variable: '--font-sora',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'Fit40',
    template: '%s | Fit40',
  },
  description: 'Strength, mobility and fitness for life after 40.',
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${sora.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

export default RootLayout;
