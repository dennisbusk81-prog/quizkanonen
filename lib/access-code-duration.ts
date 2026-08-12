import { DURATION_DAYS_CEILING } from '@/lib/access-code'

// ── Hvor lenge en verdikode gir Premium — avgjort, ikke utledet ──────────────
//
// BAKGRUNN (12. august 2026)
// Admin-skjemaet utledet «permanent» av et TOMT felt: `parseInt(form.duration_days)`,
// og `Number.isFinite(n) && n > 0 ? n : null`. Det gjorde to ting samtidig, og
// bare det ene var meningen:
//
//   • tomt felt         → null → permanent   (meningen)
//   • «seksti», «6o», « » → NaN → null → permanent   (IKKE meningen)
//
// En skrivefeil ble altså stille til en permanent kode. Og `duration_days` kan
// ikke endres etter opprettelse (se PATCHABLE_ACCESS_CODE_FIELDS i
// lib/access-code.ts), så bommen kan ikke rettes — koden må lages på nytt.
//
// Permanens er nå et EKSPLISITT valg (avkrysningsboks), og alt annet enn et
// gyldig positivt dagtall er en feil du får se, ikke en stille omtolkning.
//
// Hvorfor det er verdt å være streng her: en permanent kode som havner hos en
// betalende kunde er den ene kombinasjonen som ikke har noe riktig utfall — se
// rad G i lib/premium-state.ts. Rad G er den bindende vakten (den gjelder ALLE
// koder, også de som finnes fra før); denne funksjonen er laget for at feilen
// helst ikke skal oppstå i det hele tatt.

export type CodeDurationResult =
  | { ok: true; durationDays: number | null }
  | { ok: false; error: string }

export function resolveCodeDuration(permanent: boolean, raw: string): CodeDurationResult {
  // Avkrysset permanent: feltet er irrelevant og skal ikke kunne overstyre
  // valget. En rest fra et tidligere tastetrykk skal ikke gi 60 dager når
  // brukeren har sagt «for alltid».
  if (permanent) return { ok: true, durationDays: null }

  const trimmed = raw.trim()
  if (trimmed === '') {
    return { ok: false, error: 'Fyll inn hvor mange dager Premium skal vare, eller kryss av for permanent.' }
  }

  // `Number`, ikke `parseInt`: parseInt('60dager') gir 60 og svelger tullet.
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 1) {
    return { ok: false, error: 'Varigheten må være et helt antall dager, minst 1.' }
  }
  if (n > DURATION_DAYS_CEILING) {
    return { ok: false, error: `Varigheten kan maks være ${DURATION_DAYS_CEILING} dager.` }
  }

  return { ok: true, durationDays: n }
}
