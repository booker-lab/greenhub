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
  title: "Green Hub 드라이버",
  description: "Green Hub 드라이버 배송 앱",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "GreenHub드라이버",
  },
};

export const viewport: Viewport = {
  themeColor: "#2D6A4F",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
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
          {children}
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
