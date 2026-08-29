'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const EXCLUDED_EXACT = new Set([
  '/',
  '/login',
  '/personvern',
  '/vilkar',
  '/om',
  '/founders',
  '/founders/success',
  '/premium/success',
  '/bedrift/success',
  '/slik-fungerer-det',
  // Egen /bedrift-marketingside har nå SiteNav — kun eksakt match, IKKE prefiks,
  // så /bedrift/registrer og /bedrift/success (utenfor SiteNav-utrullingen) er uendret.
  '/bedrift',
  // Manglet i BEGGE listene fram til 29. august 2026: /arkiv rendret SiteNav og
  // fikk i tillegg denne stripen og UserMenus flytende konto-pille oppå.
  // Eksakt match, ikke prefiks — samme mønster som '/bedrift' over.
  '/arkiv',
])

export default function BackNav() {
  const pathname = usePathname()

  // Disse prefiksene har nå SiteNav (se components/SiteNav.tsx) — samme sett
  // sider som i UserMenu.tsx sin ekvivalente liste under, holdt synkronisert
  // bevisst (de to var tidligere usynkroniserte, som ga inkonsekvent nav).
  //
  // ── NÅR EN NY SIDE FÅR SiteNav: LEGG STIEN INN HER OG I UserMenu.tsx ──────
  // At de to listene er enige med HVERANDRE er ikke sjekken som betyr noe —
  // det var de også da /arkiv manglet i begge. Sjekken er mot
  // SiteNav-UTRULLINGEN: hver `app/**/page.tsx` som rendrer <SiteNav /> må
  // treffes av begge listene. `lib/site-nav-hide-lists.test.ts` gjør den
  // sammenligningen mot filsystemet.
  //
  // MERK at denne lista er et SUPERSETT av UserMenus: /personvern, /vilkar,
  // /om, /founders og *-success-sidene har hverken SiteNav eller BackNav, og
  // hører derfor hjemme her men ikke der. De to er ikke samme predikat, og
  // skal ikke slås sammen til ett.
  const hidden =
    EXCLUDED_EXACT.has(pathname) ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/liga') ||
    pathname.startsWith('/org') ||
    pathname.startsWith('/quiz') ||
    pathname.startsWith('/leaderboard') ||
    pathname.startsWith('/toppliste') ||
    pathname.startsWith('/profil') ||
    pathname.startsWith('/historikk')

  if (hidden) return null

  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 50,
      background: '#1a1c23',
      borderBottom: '1px solid #2a2d38',
      padding: '10px 16px',
    }}>
      <Link href="/" style={{
        fontFamily: "var(--font-instrument-sans), sans-serif",
        fontSize: 13,
        color: '#918f8a',
        textDecoration: 'none',
        display: 'inline-block',
      }}>
        ← Tilbake
      </Link>
    </header>
  )
}
