import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ColorSchemeScript } from "@mantine/core";
import Providers from "./providers";
import BottomNav from "@/components/BottomNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Green Love 판매자",
  description: "Green Love 판매자 관리 앱",
  manifest: "/manifest.json",
  icons: { icon: "/icons/icon-192x192.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GreenLove 판매자",
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
    <html lang="ko" className={geistSans.variable} suppressHydrationWarning>
      <head>
        <ColorSchemeScript />
      </head>
      <body>
        <Providers>
          <div style={{ maxWidth: 480, margin: '0 auto', position: 'relative', backgroundColor: 'var(--color-bg)', minHeight: '100dvh' }}>
            {children}
          </div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
