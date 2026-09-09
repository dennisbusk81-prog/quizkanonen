// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: e-postsignalene bedriftsfiltre vekter.
//
// Kartleggingen 9. september 2026 (bekreftelsesmail flagget som phishing hos
// en M365-bedrift) fant at SPF, DKIM og DMARC-justering var i orden, og at det
// som sto igjen i repoet var små signaler som teller SAMMEN når domenet er
// under seks måneder gammelt. Malene er tekst, ikke logikk, så sperren er en
// kildetekst-test — samme begrunnelse som lib/navnepolicy-etiketter.test.ts.
//
// ── DEL A: ingen lenke i e-post skal peke på apex-domenet ───────────────────
// quizkanonen.no svarer 307 til www.quizkanonen.no. Microsoft Safe Links og
// tilsvarende gatewayer følger lenken før brukeren klikker og ser et
// omdirigert klikkmål — ett av signalene de vekter. Lenkene skal derfor peke
// DIREKTE på www. Filene som voktes er de som produserer e-post-HTML; websider
// (app/vilkar m.fl.) er utenfor, en apex-lenke på en nettside er ikke et
// e-postsignal.
//
// Hvorfor ikke en delt konstant/env: NEXT_PUBLIC_SITE_URL finnes, men verdien
// er ikke verifiserbar lokalt (ikke i .env.local) og Supabase sin SITE_URL er
// apex — en env-styrt base kunne gjeninnført hoppet stille. Å gjøre malene
// env-avhengige er en egen beslutning; inntil da er www hardkodet, som de 25
// lenkene som alt pekte riktig.
//
// MUTASJONSBEVIS: én www-lenke i lib/email-templates.ts skrives tilbake til
// apex → «ingen e-postlenke peker på apex» ryker og navngir fila.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

// Filer som produserer e-post-HTML. send-reminder-ruten har en inline-mal
// utenfor lib/email-templates.ts — søsken med samme form, derfor med.
const EMAIL_SOURCES = [
  'lib/email-templates.ts',
  'app/api/org/[slug]/send-reminder/route.ts',
]

function les(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

// Apex = «https://quizkanonen.no» etterfulgt av sti, anførselstegn eller
// slutt — IKKE «https://www.quizkanonen.no» (www. står mellom // og navnet).
const APEX = /https:\/\/quizkanonen\.no(?=[/"'\s)]|$)/g

test('DEL A: ingen e-postlenke peker på apex-domenet (307 → www)', () => {
  for (const rel of EMAIL_SOURCES) {
    const src = les(rel)
    const treff = src.match(APEX) ?? []
    assert.equal(treff.length, 0,
      `${rel}: ${treff.length} lenke(r) peker på https://quizkanonen.no — skal være https://www.quizkanonen.no`)
  }
})

test('DEL A: malene peker faktisk på www (sanity — fila er lest og har lenker)', () => {
  const src = les('lib/email-templates.ts')
  const www = src.match(/https:\/\/www\.quizkanonen\.no/g) ?? []
  assert.ok(www.length >= 40, `ventet ≥40 www-lenker i malene, fant ${www.length}`)
})
