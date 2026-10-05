import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NativeShellBoot } from "../components/NativeShellBoot";
import { PwaRegister } from "../components/PwaRegister";
import { SentryClientInit } from "../components/SentryClientInit";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const OG_ALT = "Domi Ops, the household hub for homeschool families, with dashboard and calendar screens";

export const metadata: Metadata = {
  title: "Domi Ops",
  description: "Household operations — calendar, school, and daily life in one place.",
  applicationName: "Domi Ops",
  // Link unfurls (login, invites) need an absolute image URL. Self-hosters set PUBLIC_APP_URL.
  metadataBase: new URL(process.env.PUBLIC_APP_URL ?? "http://localhost:3000"),
  openGraph: {
    type: "website",
    siteName: "Domi Ops",
    title: "Domi Ops",
    description: "Household operations — calendar, school, and daily life in one place.",
    images: [{ url: "/og/og-default.png", width: 1200, height: 630, alt: OG_ALT }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Domi Ops",
    description: "Household operations — calendar, school, and daily life in one place.",
    images: [{ url: "/og/og-default.png", alt: OG_ALT }],
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Domi Ops",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#3b82f6",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        <SentryClientInit />
        {children}
        <PwaRegister />
        <NativeShellBoot />
      </body>
    </html>
  );
}
