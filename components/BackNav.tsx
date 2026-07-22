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
])

export default function BackNav() {
  const pathname = usePathname()

  // Disse prefiksene har nå SiteNav (se components/SiteNav.tsx) — samme sett
  // sider som i UserMenu.tsx sin ekvivalente liste under, holdt synkronisert
  // bevisst (de to var tidligere usynkroniserte, som ga inkonsekvent nav).
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
        fontFamily: "'Instrument Sans', sans-serif",
        fontSize: 13,
        color: '#7a7873',
        textDecoration: 'none',
        display: 'inline-block',
      }}>
        ← Tilbake
      </Link>
    </header>
  )
}
