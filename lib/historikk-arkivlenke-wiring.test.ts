// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: at inngangen til arkivet på /historikk IKKE ligger bak
// `arkiv.length > 0`.
//
// ── HVILKEN FEIL DENNE FILEN FINNES FOR ─────────────────────────────────────
// Fram til 29. august 2026 lå lenken «Spill flere fra arkivet →» inne i
// arkivseksjonen, som i sin helhet er gatet på `arkiv.length > 0`. Den var
// dermed en LUKKET SLØYFE: den eneste veien til /arkiv fra denne siden, synlig
// utelukkende for den som allerede hadde funnet arkivet en annen vei. En
// premiumbruker med null arkivforsøk — altså alle som ennå ikke har oppdaget
// funksjonen — så den aldri. Lenken kunne ikke være noens første møte med
// arkivet, som er nettopp jobben en inngang har.
//
// Feilen er lett å gjeninnføre ved en opprydding: lenken ser ut som den hører
// til radene den sto under, og «flytt den inn i seksjonen der den hører
// hjemme» er en helt rimelig refaktoreringstanke. Denne filen er vakten mot
// den tanken.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/archive-ranking-wiring.test.ts og lib/dead-session-finish-wiring.test.ts
// — npm test kjører kun lib/**/*.test.ts under Node sin egen runner, uten
// jsdom, og flaten er en 1100-linjers klientkomponent.
//
// ── KOMMENTARER MÅ STRIPPES, ELLERS ER TESTEN GRØNN AV FEIL GRUNN ───────────
// Kildekommentaren over lenken i page.tsx forklarer selv hvorfor lenken står
// UTENFOR `arkiv.length > 0`, og siterer derfor betingelsen ordrett. En naiv
// tekstsjekk ville funnet den forekomsten og trodd den var kode. `renKode()`
// fjerner blokkommentarer FØR noe måles. At `{/* … */}` blir stående igjen som
// `{}` er med vilje: klammene balanserer, så blokkuttrekket under teller
// fortsatt riktig.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Lenken flyttes tilbake INN i `{arkiv.length > 0 && (…)}` → «lenken ligger
//     utenfor arkiv.length-vakten» ryker. Dette er selve regresjonen.
//   • Lenken slettes helt → «lenken finnes» ryker.
//   • Den betingede teksten kollapses til bare «Spill flere fra arkivet» →
//     «lenketeksten er betinget» ryker (usant for den som har null forsøk).
//   • Vakten fjernes fra selve LISTEN, så et tomt seksjonshode vises →
//     «listen ligger fortsatt bak vakten» ryker.
//   • Blokkuttrekket slutter å treffe (betingelsen omskrives) → «uttrekket
//     fant arkivseksjonen» ryker, framfor at resten blir grønn på tom streng.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const RÅ = readFileSync('app/historikk/page.tsx', 'utf8')

/**
 * Kilden uten kommentarer.
 *
 * Blokkommentarer (`/* … *\/`, inkludert JSX-varianten `{/* … *\/}`) fjernes
 * først; da står `{}` igjen der en JSX-kommentar var, og klammebalansen
 * blokkuttrekket hviler på er intakt. Linjekommentarer fjernes kun når linja
 * BEGYNNER med `//`, slik at en `//` inne i en streng ikke kan spise resten
 * av linja.
 */
function renKode(kilde: string): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

const SRC = renKode(RÅ)

const VAKT = '{arkiv.length > 0 && ('

/** Innholdet i `{arkiv.length > 0 && ( … )}`, funnet ved klammetelling. */
function arkivSeksjon(): string {
  const start = SRC.indexOf(VAKT)
  assert.notEqual(
    start,
    -1,
    `fant ikke «${VAKT}» i app/historikk/page.tsx — er vakten rundt arkivLISTEN omskrevet? ` +
      'Da må denne testen skrives om, ikke slettes: den vokter at LENKEN står utenfor den.'
  )
  let depth = 0
  for (let i = start; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') {
      depth--
      if (depth === 0) return SRC.slice(start, i + 1)
    }
  }
  assert.fail('ubalanserte klammer — klarte ikke lese ut arkivseksjonen')
}

test('uttrekket fant arkivseksjonen (ikke en tom streng)', () => {
  // Uten dette ankeret ville et blokkuttrekk som feilet gjort HVER
  // «ikke inne i blokken»-test grønn — grønn av feil grunn.
  const seksjon = arkivSeksjon()
  assert.ok(seksjon.length > 200, 'arkivseksjonen ble uttrukket som nesten tom — uttrekket er ødelagt')
  assert.match(
    seksjon,
    /treningPill/,
    'den uttrukne blokken mangler «Trening»-markøren — dette er ikke arkivseksjonen'
  )
})

test('bare ÉN vakt på arkiv.length — testen måler den riktige', () => {
  const antall = SRC.split(VAKT).length - 1
  assert.equal(antall, 1, `fant ${antall} forekomster av «${VAKT}» — uttrekket kan peke på feil blokk`)
})

test('arkivlenken finnes i det hele tatt', () => {
  assert.match(
    SRC,
    /href="\/arkiv"/,
    'inngangen til /arkiv er borte fra /historikk — da har siden ingen vei til arkivet'
  )
})

test('lenken ligger UTENFOR arkiv.length-vakten (den lukkede sløyfen)', () => {
  const seksjon = arkivSeksjon()
  assert.doesNotMatch(
    seksjon,
    /href="\/arkiv"/,
    'arkivlenken ligger inne i «arkiv.length > 0» igjen. Da ser en premiumbruker med ' +
      'null arkivforsøk den aldri, og lenken kan ikke være noens første møte med arkivet ' +
      '— nøyaktig den lukkede sløyfen som ble rettet 29. august 2026.'
  )
})

test('lenketeksten er betinget — «flere» påstås ikke uten forsøk', () => {
  // «Spill flere fra arkivet» er en påstand om brukerens historikk. Med null
  // arkivforsøk er den usann, og lenken ble nettopp flyttet dit den også vises
  // til de brukerne. Begge grenene må derfor finnes.
  assert.match(SRC, /Spill flere fra arkivet/, 'mangler teksten for den som HAR arkivforsøk')
  assert.match(
    SRC,
    /Spill en tidligere quiz fra arkivet/,
    'mangler den nøytrale teksten for den som har null arkivforsøk — «Spill flere» er usant der'
  )
})

test('LISTEN over arkivforsøk ligger fortsatt bak vakten', () => {
  // Vakten skulle bare miste lenken, ikke forsvinne: et seksjonshode «Arkiv»
  // med null rader under er støy.
  const seksjon = arkivSeksjon()
  assert.match(seksjon, /sectionHeader/, 'seksjonshodet er ikke lenger bak arkiv.length-vakten')
  assert.match(seksjon, /arkiv\.map\(/, 'radutlistingen er ikke lenger bak arkiv.length-vakten')
})
