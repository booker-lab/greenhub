import type { Metadata, Viewport } from "next";
import { ColorSchemeScript } from "@mantine/core";
import Providers from "./providers";
import BottomNav from "@/components/BottomNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Green Love",
  description: "신선한 화훼·농산물 직거래 플랫폼",
  manifest: "/manifest.json",
  icons: { icon: "/icons/icon-192x192.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Green Love",
  },
};

export const viewport: Viewport = {
  themeColor: "#2D6A4F",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <ColorSchemeScript />
      </head>
      <body>
        <Providers>
          <div style={{ maxWidth: 430, margin: '0 auto', position: 'relative', backgroundColor: 'var(--color-bg)', minHeight: '100dvh' }}>
            {children}
          </div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
