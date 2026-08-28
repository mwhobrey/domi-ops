import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Headline face only — body copy stays on Inter. Space Grotesk's squared-off, slightly
// mechanical letterforms are the one thing on the page that doesn't read as generic SaaS
// template; marketing-tokens.css wires it in as --font-display with an Inter fallback.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Domi Ops — Household operations, one app",
  description:
    "Calendar, chores, shopping, notes, expenses, and homeschool: one household, one app. Self-host free or run on Domi Ops cloud.",
  applicationName: "Domi Ops",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
