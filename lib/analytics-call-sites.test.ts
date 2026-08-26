// Kjøres med:  npm test
//
// STRUKTURELL SPERRE for traktmålingens KALLSTEDER (26. august 2026).
//
// Beslutningen er oppførselstestet i lib/analytics-event.test.ts og sinket i
// lib/analytics.test.ts. Det denne filen vokter er det de to ikke KAN se:
// HVOR i den 4700 linjer lange klientkomponenten kallene står. Samme grunn og
// samme husform som lib/dead-session-finish-wiring.test.ts og
// lib/finish-quiz-timeout.test.ts — logikken ligger inline i en React-komponent
// uten React-testoppsett i prosjektet.
//
// Den viktigste invarianten i hele oppdraget bor her:
//   quiz_fullfort skal fyre der SANNHETEN er, ikke der det er beleilig.
// Klienten viser resultatskjermen ogsaa naar serveren feilet (timeout-veien,
// 503-veien, needs-login-veien). Maaler vi paa rendering, faar vi en trakt som
// lyver akkurat i den situasjonen vi mest trenger aa oppdage.
//
// MUTASJONSBEVIS — hver test peker paa en konkret feilendring den fanger:
//   • Flyttes spor('quiz_fullfort') ut av !alreadyStored-blokken (f.eks. ned
//     til setPhase('finished')) → «fyrer kun paa bekreftet lagring» ryker.
//   • Legges et spor()-kall i else-grenen (already-stored, race-taperen)
//     → «race-taperen teller ikke» ryker.
//   • Flyttes spor('quiz_startet') ut av phaseRef-vakten → «én gang per
//     spilloekt» ryker.
//   • Importeres track() direkte i en komponent → «ett sink» ryker.
//   • Legges premium_cta_vist paa en av de tre andre CTA-ene → «kun panelet»
//     ryker.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ANALYTICS_HENDELSER } from './analytics-event'

const QUIZ_SIDE = 'app/quiz/[id]/page.tsx'
const SRC = readFileSync(QUIZ_SIDE, 'utf8')

// Samme klammetelling som i lib/dead-session-finish-wiring.test.ts og
// lib/finish-quiz-timeout.test.ts. Returnerer [start, slutt) i SRC for blokken
// som aapner rett etter `decl` — en EKTE syntaktisk grense, ikke et antall
// tegn. Memory-lærdommen «avgrens vinduet paa en ekte grense, ikke et
// tegnantall» er hele grunnen til at dette ikke er en slice(idx, idx + 400).
function blokkVed(source: string, braceStart: number, hva: string): { start: number; slutt: number; tekst: string } {
  assert.equal(source[braceStart], '{', `${hva}: forventet «{» ved ${braceStart}`)
  let depth = 0
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return { start: braceStart, slutt: i + 1, tekst: source.slice(braceStart, i + 1) }
    }
  }
  throw new Error(`fant ikke slutten paa ${hva}`)
}

function blokk(source: string, decl: string): { start: number; slutt: number; tekst: string } {
  const start = source.indexOf(decl)
  assert.notEqual(start, -1, `fant ikke «${decl}» i ${QUIZ_SIDE} — er koden omskrevet?`)
  assert.equal(source.indexOf(decl, start + 1), -1, `«${decl}» finnes flere ganger — ankeret skiller ikke lenger`)
  return blokkVed(source, source.indexOf('{', start), decl)
}

// ── ANKERET ER KALLFORMEN, IKKE NAVNET ──────────────────────────────────────
// Memory-lærdommen «grep teller NAVN, ikke oppfoersel»: hendelsesnavnene staar
// ogsaa i prosa i kommentarene rundt kallene (bl.a. «Traktmaaling:
// quiz_fullfort» og «Paret til premium_cta_vist-effekten» inne i en
// {/* … */}-blokk i JSX-en). Et soek paa bare navnet ville talt de med.
// `spor({ hendelse: '<navn>'` er derimot en form som kun forekommer i et ekte
// kall — den SKILLER kode fra kommentar uten at vi trenger aa strippe
// kommentarer korrekt for tre ulike kommentarsyntakser.
// Hvitrom-tolerant med vilje: ett av kallene er skrevet over flere linjer
// (quiz_startet, som ogsaa sender vindusbredde). En test skal feste HVOR kallet
// staar, ikke hvordan det er formatert — ellers ryker den paa neste
// prettier-kjoering og sier «invarianten er brutt» om en linjeombrekking.
const kallform = (navn: string) => new RegExp(`spor\\(\\{\\s*hendelse:\\s*'${navn}'`, 'g')

function alleKall(source: string, navn: string): number[] {
  return [...source.matchAll(kallform(navn))].map(m => m.index as number)
}

function alleForekomster(source: string, noekkel: string): number[] {
  const treff: number[] = []
  let i = source.indexOf(noekkel)
  while (i !== -1) {
    treff.push(i)
    i = source.indexOf(noekkel, i + 1)
  }
  return treff
}

describe('INVARIANTEN — quiz_fullfort fyrer kun paa BEKREFTET lagring', () => {
  // `!alreadyStored` naas kun naar classifySubmitResponse ga 'scored', altsaa
  // et ekte 200 der attempts-UPDATE-en traff raden. Alle fire feilveiene
  // (error/retryable/needs-login/timeout) har returnert foer dette punktet.
  const bekreftet = blokk(SRC, 'if (!submitOutcome.value.alreadyStored) {')

  test('kallet finnes NOEYAKTIG én gang i hele filen', () => {
    const treff = alleKall(SRC, 'quiz_fullfort')
    assert.equal(treff.length, 1, `forventet 1 kall, fant ${treff.length}`)
  })

  test('kallet ligger INNE i !alreadyStored-blokken', () => {
    const [idx] = alleKall(SRC, 'quiz_fullfort')
    assert.ok(
      idx > bekreftet.start && idx < bekreftet.slutt,
      'spor(quiz_fullfort) ligger UTENFOR !alreadyStored-blokken — da kan den fyre paa en submit som ikke ble lagret',
    )
  })

  test('kallet ligger etter setServerScore — serverens tall er satt foerst', () => {
    const i = bekreftet.tekst.indexOf('setServerScore(result)')
    const j = bekreftet.tekst.search(kallform('quiz_fullfort'))
    assert.notEqual(i, -1, 'setServerScore er borte fra blokken — er bekreftelsespunktet flyttet?')
    assert.ok(j > i, 'maalingen staar foran setServerScore')
  })

  // Race-taperen: resultatet ER lagret, men av en ANNEN foresporsel som
  // allerede har talt. Maaler vi her, dobbelttelles nettopp de innsendingene
  // som gikk gjennom to ganger.
  test('else-grenen (already-stored) sender INGEN hendelse', () => {
    // Ankeret maa vaere POSISJONEN, ikke teksten: «} else {» forekommer titalls
    // ganger i filen, saa et tekstsoek ville truffet en vilkaarlig annen gren.
    // Vi starter derfor der !alreadyStored-blokken SLUTTER (bekreftet.slutt - 1
    // er dens «}») og klammeteller fra else-grenens egen «{».
    const elseStart = SRC.indexOf('} else {', bekreftet.slutt - 1)
    assert.equal(elseStart, bekreftet.slutt - 1,
      'else-grenen foelger ikke rett etter !alreadyStored-blokken — er strukturen endret?')
    const elseBlokk = blokkVed(SRC, elseStart + 7, 'else-grenen (already-stored)')
    assert.ok(elseBlokk.tekst.includes('allerede levert'),
      'fant feil blokk — else-grenen skal inneholde race-taperens console.warn')
    assert.ok(!elseBlokk.tekst.includes('spor('), 'else-grenen (race-taperen) sender en hendelse — det dobbelttelles')
  })

  // Den beleilige, loegnaktige plasseringen. setPhase('finished') naas OGSAA
  // fra 'already-stored'-stien og fra retry-/timeout-skjermene.
  test('kallet henger IKKE paa setPhase(finished)', () => {
    for (const idx of alleForekomster(SRC, "setPhase('finished')")) {
      const rundt = SRC.slice(Math.max(0, idx - 300), idx + 300)
      assert.ok(
        !kallform('quiz_fullfort').test(rundt),
        'spor(quiz_fullfort) staar ved en setPhase(finished) — den naas ogsaa naar ingenting ble lagret',
      )
    }
  })
})

describe('quiz_startet — én gang per spilloekt, ikke per start-attempt-svar', () => {
  // Vakten finnes fra foer (den beskytter fremdriften mot dobbel nullstilling);
  // maalingen arver idempotensen ved aa staa inne i den. To av start-attempt
  // sine tre suksess-utganger er GJENBRUK, saa en maaling paa svaret ville
  // telt en reload som ny start.
  const spillestart = blokk(SRC, "if (phaseRef.current !== 'playing') {")

  test('kallet finnes noeyaktig én gang', () => {
    assert.equal(alleKall(SRC, 'quiz_startet').length, 1)
  })

  test('kallet ligger inne i phaseRef-vakten', () => {
    const [idx] = alleKall(SRC, 'quiz_startet')
    assert.ok(
      idx > spillestart.start && idx < spillestart.slutt,
      'spor(quiz_startet) ligger utenfor phaseRef-vakten — en reload vil da telle som ny start',
    )
  })

  test('bredden sendes her, og kun her', () => {
    assert.ok(spillestart.tekst.includes('window.innerWidth'), 'bredden leses ikke ved quiz_startet')
    // MERK: `window.innerWidth` leses ogsaa to andre steder i filen fra foer
    // (konfetti-canvasets bredde, og en koordinatberegning) — de har ingenting
    // med maaling aa gjoere. Ankeret maa derfor vaere PARAMETEREN som sender
    // bredden videre, ikke lesningen av den. Det er den som er begrenset av
    // Pro-taket paa 2 properties.
    assert.equal(alleForekomster(SRC, 'vindusbredde:').length, 1,
      'vindusbredde sendes fra flere kallsteder — bredden skal kun paa quiz_startet (taket er 2 properties)')
    const [idx] = alleForekomster(SRC, 'vindusbredde:')
    assert.ok(idx > spillestart.start && idx < spillestart.slutt,
      'vindusbredde sendes fra et annet kallsted enn quiz_startet')
  })

  test('maalingen staar ETTER setPhase(playing) — ingenting venter paa den', () => {
    const i = spillestart.tekst.indexOf("setPhase('playing')")
    const j = spillestart.tekst.search(kallform('quiz_startet'))
    assert.ok(i !== -1 && j > i, 'maalingen staar foran setPhase(playing)')
  })
})

describe('premium-CTA — kun panelet, bevisst', () => {
  test('vist og klikk finnes noeyaktig én gang hver', () => {
    assert.equal(alleKall(SRC, 'premium_cta_vist').length, 1)
    assert.equal(alleKall(SRC, 'premium_cta_klikk').length, 1)
  })

  // Paret maa dele gate, ellers er trakten usammenlignbar med seg selv.
  // Panelet rendres paa `isLoggedIn && !isPremium`; effekten legger til
  // `phase !== 'finished'`, som er implisitt for panelet.
  test('vist-effekten deler gate med panelet', () => {
    const [idx] = alleKall(SRC, 'premium_cta_vist')
    const effekt = SRC.slice(Math.max(0, idx - 400), idx)
    assert.ok(effekt.includes("phase !== 'finished' || !isLoggedIn || isPremium"),
      'vist-effekten har ikke samme gate som panelet — da maales en visning som ikke skjedde')
  })

  test('klikket henger paa den samme lenken som panelet', () => {
    const [idx] = alleKall(SRC, 'premium_cta_klikk')
    const rundt = SRC.slice(Math.max(0, idx - 200), idx + 600)
    assert.ok(rundt.includes('href="/premium"'), 'klikk-kallet henger ikke paa en /premium-lenke')
    assert.ok(rundt.includes('Oppgrader til Premium →') || rundt.includes('ingen kortinfo'),
      'klikk-kallet staar ikke paa panelets knapp')
  })

  // De tre andre CTA-ene maales BEVISST ikke. Uten dette kunne noen «fullfoere»
  // maalingen senere uten aa kjenne valget — og «vist» ville sluttet aa bety
  // antall spillere som saa et CTA.
  test('de tre andre premium-lenkene har INGEN maaling', () => {
    const treff = alleForekomster(SRC, 'Oppgrader til Premium for å se nøyaktig plassering')
    assert.equal(treff.length, 2, `forventet de 2 plasseringslenkene, fant ${treff.length}`)
    for (const idx of treff) {
      const rundt = SRC.slice(Math.max(0, idx - 500), idx + 200)
      assert.ok(!rundt.includes('spor('), 'en plasserings-CTA har faatt maaling — det bryter vist/klikk-paret')
    }
    const laast = SRC.indexOf('Se dine svar\n')
    if (laast !== -1) {
      const rundt = SRC.slice(Math.max(0, laast - 900), laast + 200)
      assert.ok(!rundt.includes('spor('), '«Se dine svar»-CTA-et har faatt maaling')
    }
  })

  test('begrunnelsen for aa utelate de tre staar i koden', () => {
    assert.ok(SRC.includes('FIRE PREMIUM-CTA-ER'),
      'kommentaren som forklarer at de tre andre bevisst ikke maales er borte')
  })
})

describe('ETT SINK — track() kalles kun fra lib/analytics.ts', () => {
  // Hele poenget med helperen: er den ikke den eneste inngangen, kan en
  // framtidig kaller sende hva som helst forbi hvitelisten. Samme prinsipp som
  // escapingen i lib/email-templates.ts og scrubEvent() i lib/sentry-scrub.ts.
  // Verdien er importstien UTEN anfoerselstegn: repoet bruker begge stilene
  // (page.tsx enkle, layout.tsx doble), og testen skal feste HVILKEN modul som
  // importeres — ikke sitatstilen.
  const TILLATT = new Map<string, string>([
    // Sinket. Eneste sted `track` importeres.
    ['lib/analytics.ts', '@vercel/analytics'],
    // Selve maaleskriptet. Importerer <Analytics />, ikke track.
    ['app/layout.tsx', '@vercel/analytics/next'],
  ])

  function tsFiler(dir: string, ut: string[] = []): string[] {
    for (const navn of readdirSync(dir)) {
      if (navn === 'node_modules' || navn === '.next' || navn === '.git') continue
      const sti = join(dir, navn)
      if (statSync(sti).isDirectory()) tsFiler(sti, ut)
      else if (/\.(ts|tsx)$/.test(navn) && !navn.endsWith('.test.ts')) ut.push(sti.replace(/\\/g, '/'))
    }
    return ut
  }

  test('ingen andre filer importerer fra @vercel/analytics', () => {
    // Ankeret er IMPORT-SETNINGEN, ikke navnet. lib/analytics-event.ts NEVNER
    // «@vercel/analytics» i en kommentar (nettopp for aa si at den ikke kjenner
    // pakken), og et raat tekstsoek flagget den som synder. Samme
    // memory-lærdom som over: grep teller navn, ikke oppfoersel.
    const IMPORT_RE = /(?:^import[\s\S]*?from\s*['"]|require\(\s*['"])(@vercel\/analytics[^'"]*)['"]/gm
    const syndere: string[] = []
    for (const fil of [...tsFiler('app'), ...tsFiler('lib'), ...tsFiler('components')]) {
      const innhold = readFileSync(fil, 'utf8')
      const stier = [...innhold.matchAll(IMPORT_RE)].map(m => m[1])
      if (stier.length === 0) continue
      const forventet = TILLATT.get(fil)
      if (!forventet) { syndere.push(fil); continue }
      assert.deepEqual(stier, [forventet], `${fil} importerer ${stier.join(', ')} — forventet kun ${forventet}`)
    }
    assert.deepEqual(syndere, [],
      `disse filene importerer @vercel/analytics utenom sinket: ${syndere.join(', ')}`)
  })

  test('quiz-siden gaar gjennom spor(), ikke track()', () => {
    assert.ok(SRC.includes("import { spor } from '@/lib/analytics'"), 'quiz-siden importerer ikke spor()')
    assert.ok(!SRC.includes('@vercel/analytics'), 'quiz-siden importerer @vercel/analytics direkte')
  })
})

describe('alle fire hendelsene er faktisk koblet opp', () => {
  // Motstykket til alle «ingenting skal skje»-testene: uten denne kunne hele
  // maalingen vaere fjernet og resten fortsatt vaere groent.
  for (const hendelse of ANALYTICS_HENDELSER) {
    test(`${hendelse} har et kallsted`, () => {
      assert.equal(alleKall(SRC, hendelse).length, 1,
        `${hendelse} har ikke noeyaktig ett kallsted i ${QUIZ_SIDE}`)
    })
  }
})
