'use client'

import Link from 'next/link'
import { signInWithGoogle } from '@/lib/auth'

export default function PricingSection() {
  return (
    <section className="qk-pricing">
      <div className="qk-section">
        <span className="qk-section-text">Hva er inkludert</span>
        <div className="qk-section-line" />
      </div>

      <div className="qk-pricing-grid">

        {/* Kolonne 1 — Uten konto */}
        <div className="qk-pricing-col">
          <p className="qk-pricing-tier qk-pricing-tier--muted">Uten konto</p>
          <div className="qk-pricing-head-spacer" />
          <ul className="qk-pricing-list">
            <li className="qk-pricing-item qk-pricing-item--yes">✓ Spill quizen</li>
            <li className="qk-pricing-item qk-pricing-item--yes">✓ Se omtrentlig plassering</li>
            <li className="qk-pricing-item qk-pricing-item--no">– Fast spillernavn</li>
            <li className="qk-pricing-item qk-pricing-item--no">– Nøyaktig plassering</li>
            <li className="qk-pricing-item qk-pricing-item--no">– Historikk</li>
            <li className="qk-pricing-item qk-pricing-item--no">– Private ligaer</li>
          </ul>
        </div>

        {/* Kolonne 2 — Innlogget gratis */}
        <div className="qk-pricing-col">
          <p className="qk-pricing-tier qk-pricing-tier--free">Innlogget — gratis</p>
          <div className="qk-pricing-head-spacer" />
          <ul className="qk-pricing-list">
            <li className="qk-pricing-item qk-pricing-item--yes">✓ Spill quizen</li>
            <li className="qk-pricing-item qk-pricing-item--yes">✓ Du huskes på topplisten</li>
            <li className="qk-pricing-item qk-pricing-item--yes">✓ Fast spillernavn</li>
            <li className="qk-pricing-item qk-pricing-item--yes">✓ Nøyaktig plassering</li>
            <li className="qk-pricing-item qk-pricing-item--no">– Historikk</li>
            <li className="qk-pricing-item qk-pricing-item--no">– Private ligaer</li>
          </ul>
          <button
            onClick={() => signInWithGoogle()}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              background: '#ffffff',
              color: '#1a1c23',
              fontFamily: "'Instrument Sans', sans-serif",
              fontSize: 15,
              fontWeight: 600,
              padding: '13px 20px',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s, transform 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f0f0f0'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.transform = 'none' }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M19.6 10.23c0-.7-.063-1.39-.182-2.05H10v3.878h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.232C18.344 15.925 19.6 13.27 19.6 10.23z" fill="#4285F4"/>
              <path d="M10 20c2.7 0 4.964-.896 6.618-2.424l-3.232-2.51c-.896.6-2.042.955-3.386.955-2.604 0-4.81-1.758-5.598-4.12H1.064v2.592A9.996 9.996 0 0 0 10 20z" fill="#34A853"/>
              <path d="M4.402 11.901A6.02 6.02 0 0 1 4.09 10c0-.662.113-1.305.312-1.901V5.507H1.064A9.996 9.996 0 0 0 0 10c0 1.614.386 3.14 1.064 4.493l3.338-2.592z" fill="#FBBC05"/>
              <path d="M10 3.98c1.468 0 2.786.504 3.822 1.496l2.868-2.868C14.959.992 12.695 0 10 0A9.996 9.996 0 0 0 1.064 5.507l3.338 2.592C5.19 5.738 7.396 3.98 10 3.98z" fill="#EA4335"/>
            </svg>
            Logg inn med Google
          </button>
          <p className="qk-pricing-sub">Ingen kortinfo nødvendig</p>
        </div>

        {/* Kolonne 3 — Premium */}
        <div className="qk-pricing-col qk-pricing-col--premium">
          <p className="qk-pricing-tier qk-pricing-tier--premium">Premium</p>
          <p className="qk-pricing-price">kr 49/mnd</p>
          <ul className="qk-pricing-list">
            <li className="qk-pricing-item qk-pricing-item--premium">✦ Alt fra innlogget</li>
            <li className="qk-pricing-item qk-pricing-item--premium">✦ Quizhistorikk og statistikk</li>
            <li className="qk-pricing-item qk-pricing-item--premium">✦ Følg din utvikling</li>
            <li className="qk-pricing-item qk-pricing-item--premium">✦ Private ligaer</li>
            <li className="qk-pricing-item qk-pricing-item--premium">✦ XP og rangtitler</li>
            <li className="qk-pricing-item qk-pricing-item--premium">✦ Avslutt når du vil</li>
          </ul>
          <Link href="/founders" className="qk-pricing-btn qk-pricing-btn--premium">
            Prøv gratis i 1 måned
          </Link>
          <p className="qk-pricing-sub">Ingen kortinfo nødvendig</p>
        </div>

      </div>
    </section>
  )
}
