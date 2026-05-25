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
])

export default function BackNav() {
  const pathname = usePathname()

  const hidden =
    EXCLUDED_EXACT.has(pathname) ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/liga') ||
    pathname.startsWith('/org')

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
