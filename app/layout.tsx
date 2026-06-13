import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ConsentBanner from "@/components/ConsentBanner";
import AuthListener from "@/components/AuthListener";
import NameRequiredModal from "@/components/NameRequiredModal";
import UserMenu from "@/components/UserMenu";
import UserMenuErrorBoundary from "@/components/UserMenuErrorBoundary";
import BackNav from "@/components/BackNav";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import Link from "next/link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Quizkanonen",
  description: "Ukentlig quiz for deg og laget ditt",
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'apple-mobile-web-app-title': 'Quizkanonen',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="no"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#c9a84c" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="min-h-full flex flex-col">
        <UserMenuErrorBoundary>
          <UserMenu />
        </UserMenuErrorBoundary>
        <BackNav />
        {children}
        <AuthListener />
        <NameRequiredModal />
        <ServiceWorkerRegistration />
        <ConsentBanner />
        <footer className="border-t border-gray-800 py-6 mt-8">
          <div className="max-w-5xl mx-auto px-4 flex flex-wrap gap-4 justify-center text-xs text-gray-500">
            <span>© 2026 Quizkanonen</span>
            <Link href="/om" className="hover:text-gray-300 transition-all">Om Quizkanonen</Link>
            <Link href="/slik-fungerer-det" className="hover:text-gray-300 transition-all">Slik fungerer det</Link>
            <Link href="/personvern" className="hover:text-gray-300 transition-all">Personvernerklæring</Link>
            <Link href="/vilkar" className="hover:text-gray-300 transition-all">Brukervilkår</Link>
            <a href="mailto:quizkanonen@gmail.com" className="hover:text-gray-300 transition-all">Kontakt</a>
          </div>
        </footer>
      </body>
    </html>
  );
}