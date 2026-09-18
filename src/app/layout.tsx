import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { TEAM_NAME } from "@/lib/memory/catalog";
import { getStore } from "@/lib/store";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Grist — local-first coding mill",
  description:
    "Confidence-gated coding agents. Local by default, frontier by score, human when unknown.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  const store = getStore();
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <AppShell team={TEAM_NAME} threshold={store.settings.confidenceThreshold}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
