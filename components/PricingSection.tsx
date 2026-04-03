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
            type="button"
            className="qk-pricing-btn qk-pricing-btn--free"
            style={{ width: '100%', cursor: 'pointer' }}
            onClick={() => signInWithGoogle()}
          >
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
