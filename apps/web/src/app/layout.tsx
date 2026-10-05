import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { NativeShellBoot } from "../components/NativeShellBoot";
import { PwaRegister } from "../components/PwaRegister";
import { SentryClientInit } from "../components/SentryClientInit";
import { originFromHeaders } from "../lib/request-origin";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const OG_ALT = "Domi Ops, the household hub for homeschool families, with dashboard and calendar screens";

// Resolved per request. Link unfurls (login, invites) need an absolute image URL, and the same
// published image serves every deployment, so it cannot come from PUBLIC_APP_URL, which Next inlines
// at build time. The page is already dynamic (it reads the session cookie).
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const origin = originFromHeaders((name) => h.get(name));
  return {
    ...baseMetadata,
    ...(origin ? { metadataBase: new URL(origin) } : {}),
  };
}

const baseMetadata: Metadata = {
  title: "Domi Ops",
  description: "Household operations — calendar, school, and daily life in one place.",
  applicationName: "Domi Ops",
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
