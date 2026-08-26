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
import ProfileProvider from "@/components/ProfileProvider";
import Link from "next/link";
// Importstien Vercels egen Next.js-onboarding oppgir — `/next`, ikke `/react`.
// Pakken eksporterer begge; `/next` er den som er bygget for App Router.
// `track()` (lib/analytics.ts) kommer derimot fra pakkeroten, som er der den
// eksporteres fra — verifisert mot dist/next/index.d.ts og dist/index.d.ts i
// v2.0.1: `/next` eksporterer KUN `Analytics`.
import { Analytics } from "@vercel/analytics/next";

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
        <ProfileProvider>
        <UserMenuErrorBoundary>
          <UserMenu />
        </UserMenuErrorBoundary>
        <BackNav />
        {children}
        <AuthListener />
        <NameRequiredModal />
        <ServiceWorkerRegistration />
        {/* Vercel Web Analytics. Sidevisninger måles automatisk herfra; de fire
            egendefinerte hendelsene går gjennom lib/analytics.ts.
            Ingen ny databehandler: Vercel står allerede i personvernerklæringen
            som hosting-leverandør.
            Ligger bevisst UTENFOR ConsentBanner. Grunnlaget er Vercels egen
            dokumentasjon (vercel.com/docs/analytics/privacy-policy, lest
            26. august 2026): ingen tredjeparts-cookies — besøkende
            identifiseres av «a hash created from the incoming request» som
            forkastes etter 24 timer — og datapunktene er «not being tied to or
            associated with any individual, customer, or IP address».
            ⚠ Dette er en PERSONVERNPÅSTAND, ikke en teknisk detalj: endrer
            Vercel innsamlingen, eller legges det til en property som kan
            identifisere noen, må plasseringen her vurderes på nytt. */}
        <Analytics />
        <ConsentBanner />
        <footer className="border-t border-gray-800 py-6 mt-8">
          <div className="max-w-5xl mx-auto px-4 flex flex-wrap gap-4 justify-center text-xs" style={{ color: '#918f8a' }}>
            <span>© 2026 Quizkanonen</span>
            {/* prefetch={false}: footeren ligger i root layout og er dermed på ALLE
                sider. Uten dette prefetchet Next disse fire statiske infosidene 2–3
                ganger hver per sidevisning (målt: tre sidelastninger, to maskiner,
                ulik _rsc-hash per gang) — 8–12 unødvendige requests, og like mange
                middleware-getUser()-kall mot Supabase for innloggede brukere, siden
                middleware-matcheren ikke ekskluderer RSC-forespørsler. Sidene er
                statiske og klikkes sjelden umiddelbart; Next prefetcher dem
                fortsatt ved hover. */}
            <Link href="/om" prefetch={false} className="qk-footer-link transition-all">Om Quizkanonen</Link>
            <Link href="/slik-fungerer-det" prefetch={false} className="qk-footer-link transition-all">Slik fungerer det</Link>
            <Link href="/personvern" prefetch={false} className="qk-footer-link transition-all">Personvernerklæring</Link>
            <Link href="/vilkar" prefetch={false} className="qk-footer-link transition-all">Brukervilkår</Link>
            <a href="mailto:quizkanonen@gmail.com" className="qk-footer-link transition-all">Kontakt</a>
          </div>
        </footer>
        </ProfileProvider>
      </body>
    </html>
  );
}