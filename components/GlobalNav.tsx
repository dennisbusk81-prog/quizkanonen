'use client'

import { usePathname } from 'next/navigation'
import SiteNav from '@/components/SiteNav'
import { hasGlobalNav } from '@/lib/global-nav-routes'

// ── Den globale toppnav-en (B-30/A2 steg 2) ─────────────────────────────────
// Montert i app/layout.tsx (innenfor ProfileProvider, wrappet i
// NavErrorBoundary) og rendrer <SiteNav /> på ALLE ruter som ikke står i
// opt-out-registeret i lib/global-nav-routes.ts. Feilretningen er snudd med
// vilje: en glemt ny rute får nav den kanskje ikke trengte, i stedet for en
// side der brukeren står fast.
//
// Registeret og segmentmatcheren bor i lib-fila, IKKE her — da kan
// lib/global-nav-coverage.test.ts importere og kjøre nøyaktig samme logikk
// som produksjonen, uten å regex-parse denne komponenten.
//
// ⚠ CONTAINING BLOCK-FELLA (AuthModal-havariet i c47b87f): et element med
// `filter`, `backdrop-filter`, `transform` eller `perspective` på seg blir
// containing block for `position: fixed`-etterkommere. GlobalNav monteres som
// direkte barn av <body> nettopp for at ingen slik forelder skal stå over
// SiteNav — flytt den aldri inn i et element med de stilene.

export default function GlobalNav() {
  const pathname = usePathname()
  // null skal aldri skje for en side i App Router; faller den likevel ut,
  // er default-retningen nav PÅ — samme feilretning som resten av modellen.
  if (pathname && !hasGlobalNav(pathname)) return null
  return <SiteNav />
}
