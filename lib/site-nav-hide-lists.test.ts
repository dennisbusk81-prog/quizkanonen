// Kjøres med:  npm test
//
// STRUKTURTEST av de to skjule-listene som holder den globale <UserMenu /> og
// <BackNav /> (begge montert i app/layout.tsx) borte fra sider som har sin egen
// SiteNav.
//
// BAKGRUNN (29. august 2026)
// `/arkiv` rendret <SiteNav /> — med NavAuths konto-meny — og fikk i tillegg
// den globale UserMenu-pillen liggende oppå, pluss en løs «← Tilbake»-stripe.
// To konto-menyer på samme skjerm, med ULIKT innhold: UserMenu har «Innlogget
// som», Premium-merket, fornyelsesdato og «Sesong-topplisten →»; NavAuths
// dropdown har ingen av delene.
//
// Kommentarene i begge filene sa at listene «holdes synkronisert». Det gjorde
// de — med HVERANDRE. Begge manglet /arkiv. Den sammenligningen som betyr noe
// er mot SiteNav-UTRULLINGEN, og den kan ingen holde i hodet: den bor i
// filsystemet. Denne testen gjør den.
//
// ── HVORFOR DENNE ER STRUKTURELL, OG HVA SOM GJØR DET FORSVARLIG ───────────
// Predikatene bor inline i to 'use client'-komponenter med React-hooks, og kan
// ikke importeres av node:test. Testen leser derfor KILDEN. Det er formen
// husets regler advarer mot, og de to kjente fellene er håndtert eksplisitt:
//
//   1. «Regex passerer utkommentert kode.» Kommentarene i BEGGE filene
//      inneholder nå bokstavelig `startsWith('/quiz')` og `'/quizer'` som
//      forklarende TEKST — en naiv regex ville plukket dem opp som regler og
//      vært grønn av feil grunn. Derfor strimles kommentarer av en tokenizer
//      som respekterer strenglitteraler (`fjernKommentarer` under), ikke av en
//      regex. `selvtest`-blokken nederst feller tokenizeren direkte.
//   2. «Grep teller NAVN, ikke oppførsel.» Testen sjekker ikke at en streng
//      FINNES i fila. Den bygger regler av `=== 'x'` / `startsWith('x')` /
//      Set-innholdet, og EVALUERER dem mot hver rute — samme semantikk som
//      komponentene. Derfor fanger den at `/quizer` allerede dekkes av
//      prefikset `/quiz`, i stedet for å kreve en egen linje som ikke trengs.
//
// Utvinningen er likevel koblet til skriveformen. `assert`-ene under «Vakt mot
// stille utvinningssvikt» finnes for at et omskrevet predikat skal gi
// «parseren må oppdateres» og ikke «siden mangler i lista» — en rød test som
// lyver om årsaken er verre enn ingen test.
//
// ── MUTASJONSBEVIS (kjørt 29. august 2026, hver mutasjon gjenopprettet) ─────
// Fiksen ble staget først, så `git diff` viser kun mutasjonen og
// `git checkout --` gjenoppretter fiksen i stedet for å kaste den:
//   1. fjern `pathname === '/arkiv' ||` fra UserMenu.tsx
//      → RØD: «/arkiv → mangler i components/UserMenu.tsx» — feilen navngir
//        både ruten og filen, som er hele poenget med å bygge en liste
//   2. fjern `'/arkiv',` fra BackNav.tsx sitt EXCLUDED_EXACT
//      → RØD: samme rute, andre fil
//   3. bytt UserMenus `startsWith('/quiz')` mot `startsWith('/quiz/')`
//      → RØD på «hver side …» (/quiz og /quizer) OG på «/quizer dekkes av
//        prefikset», og GRØNN på begge selvtestene. Beviser to ting: at
//        testen evaluerer prefiks-semantikk i stedet for å lete etter
//        strenger, og at selvtestene ikke er koblet til reglenes innhold.
//   4. la `fjernKommentarer` returnere kilden urørt
//      → RØD på BEGGE selvtestene og grønn på resten. Det er riktig rekkefølge:
//        en ødelagt tokenizer melder seg selv, i stedet for å gi falsk grønt
//        på 1 og 2 ved å lese `'/arkiv'` ut av en kommentar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'

const ROT = join(import.meta.dirname, '..')

/**
 * Fjerner // - og / * * / -kommentarer, men lar innholdet i strenglitteraler
 * stå. En regex kan ikke gjøre dette: `startsWith('/quiz')` inne i en
 * kommentar ser identisk ut med den ekte regelen, og `'https://…'` inne i en
 * streng ser ut som en kommentarstart.
 */
function fjernKommentarer(kilde: string): string {
  let ut = ''
  let i = 0
  let streng: string | null = null   // aktivt anførselstegn, ellers null

  while (i < kilde.length) {
    const c = kilde[i], neste = kilde[i + 1]

    if (streng) {
      if (c === '\\') { ut += c + (neste ?? ''); i += 2; continue }
      if (c === streng) streng = null
      ut += c; i++; continue
    }

    if (c === '"' || c === "'" || c === '`') { streng = c; ut += c; i++; continue }

    if (c === '/' && neste === '/') {
      while (i < kilde.length && kilde[i] !== '\n') i++
      continue
    }
    if (c === '/' && neste === '*') {
      i += 2
      while (i < kilde.length && !(kilde[i] === '*' && kilde[i + 1] === '/')) i++
      i += 2
      continue
    }

    ut += c; i++
  }
  return ut
}

// ── Rutene som faktisk rendrer <SiteNav /> ──────────────────────────────────

function finnSider(dir: string, funnet: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) finnSider(p, funnet)
    else if (e.name === 'page.tsx') funnet.push(p)
  }
  return funnet
}

/**
 * Filsti → rute. Rutegrupper `(navn)` faller bort (de er ikke i URL-en), og
 * ruten kuttes ved FØRSTE dynamiske segment: `app/liga/[slug]/page.tsx` blir
 * `/liga`, som er den delen skjule-listene faktisk kan matche på.
 */
function tilRute(filsti: string): string {
  const rel = filsti.slice(join(ROT, 'app').length + 1)
  const segmenter: string[] = []
  for (const s of rel.split(sep).slice(0, -1)) {
    if (s.startsWith('(') && s.endsWith(')')) continue
    if (s.startsWith('[')) break
    segmenter.push(s)
  }
  return '/' + segmenter.join('/')
}

const siteNavRuter = [...new Set(
  finnSider(join(ROT, 'app'))
    .filter(f => /<SiteNav[\s/>]/.test(fjernKommentarer(readFileSync(f, 'utf8'))))
    .map(tilRute)
)].sort()

// ── Reglene, hentet ut av kilden og gjort kjørbare ──────────────────────────

type Regel = { form: 'eksakt' | 'prefiks'; sti: string }

function alleTreff(kilde: string, re: RegExp): string[] {
  return [...kilde.matchAll(re)].map(m => m[1])
}

const userMenuKilde = fjernKommentarer(
  readFileSync(join(ROT, 'components', 'UserMenu.tsx'), 'utf8')
)
const backNavKilde = fjernKommentarer(
  readFileSync(join(ROT, 'components', 'BackNav.tsx'), 'utf8')
)

const userMenuRegler: Regel[] = [
  ...alleTreff(userMenuKilde, /pathname === '([^']+)'/g).map(sti => ({ form: 'eksakt' as const, sti })),
  ...alleTreff(userMenuKilde, /pathname\.startsWith\('([^']+)'\)/g).map(sti => ({ form: 'prefiks' as const, sti })),
]

// EXCLUDED_EXACT er et Set-litteral; innholdet hentes som ett stykke og
// splittes, slik at nye linjer i settet følger med uten at parseren endres.
const settInnhold = backNavKilde.match(/EXCLUDED_EXACT = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
const backNavRegler: Regel[] = [
  ...alleTreff(settInnhold, /'([^']+)'/g).map(sti => ({ form: 'eksakt' as const, sti })),
  ...alleTreff(backNavKilde, /pathname\.startsWith\('([^']+)'\)/g).map(sti => ({ form: 'prefiks' as const, sti })),
]

// Samme semantikk som komponentene: eksakt likhet ELLER prefiks.
const skjuler = (regler: Regel[], rute: string) =>
  regler.some(r => (r.form === 'eksakt' ? rute === r.sti : rute.startsWith(r.sti)))

// ── Selvtest av tokenizeren ─────────────────────────────────────────────────
// Kjøres FØRST. Feiler den, er alt under verdiløst — og uten denne ville en
// ødelagt tokenizer gitt GRØNT på testene under, fordi kommentarene i begge
// filene nå bokstavelig inneholder regel-lignende tekst.

test('selvtest: kommentarer strimles, strenger står', () => {
  const kilde = [
    `const a = '/beholdes'`,
    `// pathname === '/kommentar-eksakt'`,
    `const b = "http://ikke-en-kommentar"`,
    `/* pathname.startsWith('/kommentar-prefiks') */`,
    `const c = \`/back\\'tick\``,
  ].join('\n')
  const rent = fjernKommentarer(kilde)

  assert.ok(rent.includes('/beholdes'), 'strenglitteraler skal overleve')
  assert.ok(rent.includes('http://ikke-en-kommentar'),
    '// inne i en streng er ikke en kommentarstart')
  assert.ok(!rent.includes('/kommentar-eksakt'), '//-kommentarer skal bort')
  assert.ok(!rent.includes('/kommentar-prefiks'), 'blokk-kommentarer skal bort')
  assert.ok(rent.includes('/back'), 'escapede tegn skal ikke velte tokenizeren')
})

test('selvtest: kommentarene i DE TO EKTE filene er faktisk strimlet bort', () => {
  // Ikke en påstand om reglene, men om strimlingen av nettopp disse to
  // filene: frasene under finnes kun i prosatekst og kan aldri bli kode.
  // Slutter tokenizeren å virke, ryker denne — og ikke «siden mangler i
  // lista», som ville pekt på feil årsak.
  //
  // Assertionen er bevisst IKKE `!regler.some(sti === '/quiz/')`: en dag noen
  // med rette snevrer prefikset inn til '/quiz/', skal denne testen forbli
  // grønn. Da er det testen «/quizer dekkes av prefikset /quiz» som skal si
  // fra, fordi DEN handler om oppførsel.
  assert.ok(!userMenuKilde.includes('SAMMENTREFF i navngivningen'),
    'UserMenu.tsx: kommentarene er ikke strimlet — regel-lignende tekst i dem kan da bli lest som regler')
  assert.ok(!backNavKilde.includes('SUPERSETT av UserMenus'),
    'BackNav.tsx: kommentarene er ikke strimlet')
  assert.ok(!userMenuRegler.some(r => r.sti === '/quizer'),
    'UserMenu nevner /quizer kun i en kommentar — den skal ikke bli en regel')
})

// ── Vakt mot stille utvinningssvikt ─────────────────────────────────────────

test('parseren finner fortsatt reglene i begge filene', () => {
  // Skrives et av predikatene om til en annen form (en Set, et array, en
  // hjelpefunksjon), skal feilen si DET — ikke «siden mangler i lista».
  // Tallene er nedre grenser med god margin, ikke fasit: å legge til en sti
  // skal aldri gjøre denne rød.
  assert.ok(userMenuRegler.length >= 12,
    `fant bare ${userMenuRegler.length} regler i UserMenu.tsx — er predikatet skrevet om? Oppdater parseren i denne testen.`)
  assert.ok(backNavRegler.filter(r => r.form === 'eksakt').length >= 10,
    'fant for få EXCLUDED_EXACT-oppføringer i BackNav.tsx — er Set-litteralet skrevet om?')
  assert.ok(backNavRegler.filter(r => r.form === 'prefiks').length >= 8,
    'fant for få startsWith-regler i BackNav.tsx — er kjeden skrevet om?')
  assert.ok(siteNavRuter.length >= 10,
    `fant bare ${siteNavRuter.length} SiteNav-sider — er komponenten omdøpt eller rendret via en innpakning?`)
})

// ── Selve regelen ───────────────────────────────────────────────────────────

test('hver side med SiteNav er skjult i BEGGE listene', () => {
  const mangler: string[] = []
  for (const rute of siteNavRuter) {
    if (!skjuler(userMenuRegler, rute)) mangler.push(`${rute} → mangler i components/UserMenu.tsx`)
    if (!skjuler(backNavRegler, rute)) mangler.push(`${rute} → mangler i components/BackNav.tsx`)
  }
  assert.deepEqual(mangler, [],
    'en side med egen SiteNav får da to konto-menyer og/eller en løs «← Tilbake»-stripe:\n  ' +
    mangler.join('\n  '))
})

test('/quizer dekkes av prefikset /quiz — ingen egen linje trengs', () => {
  // Ikke pynt: kartleggingen som utløste denne runden påsto først at /quizer
  // hadde samme feil som /arkiv. Det stemte ikke — `startsWith('/quiz')`,
  // skrevet for spillesiden /quiz/[id], treffer også /quizer. Testen holder
  // det faktum i live, slik at en innsnevring til '/quiz/' blir fanget her og
  // ikke oppdaget på skjermen.
  assert.ok(siteNavRuter.includes('/quizer'), 'forutsetningen: /quizer har SiteNav')
  assert.ok(skjuler(userMenuRegler, '/quizer') && skjuler(backNavRegler, '/quizer'))
  assert.ok(
    !userMenuRegler.some(r => r.form === 'eksakt' && r.sti === '/quizer'),
    'dekningen skal komme fra prefikset, ikke fra en egen linje — står det en her, er kommentaren i UserMenu.tsx utdatert'
  )
})
