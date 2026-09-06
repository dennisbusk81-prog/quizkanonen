// Kjøres med:  npm test
//
// Scope-bryteren på /toppliste (6. september 2026). To lag:
//   • decideTopplisteScope — ren logikk, testet direkte med ekte kall.
//   • Koblingen i app/toppliste/page.tsx og propene ned — strukturelt, fordi
//     npm test kjører uten jsdom (samme grunn som lib/kontomeny-arkivlenke).
//
// ── DEN VIKTIGSTE INVARIANTEN ───────────────────────────────────────────────
// Bryteren endrer IKKE hvem som har tilgang til hva. Gaten ligger i
// /api/toppliste og verifiserer medlemskap på hver eneste forespørsel, uansett
// hva klienten viser. Testene under vokter at klienten ikke later som noe
// annet, og at premiumView-regelen står urørt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideTopplisteScope } from './toppliste-scope'

const A = { orgId: 'org-a' }
const B = { orgId: 'org-b' }

/** Standardtilfellet: medlemskapene er bekreftet og hentingen gikk bra. */
function bekreftet(myOrgs: { orgId: string }[], scopeParam: string | null, scopeIdParam: string | null) {
  return decideTopplisteScope({ scopeParam, scopeIdParam, myOrgs, myOrgsLoaded: true, myOrgsError: false })
}

// ── Skinnen vises kun til den som har noe å bytte mellom ────────────────────

test('ingen org ⇒ ingen skinne', () => {
  // En vanlig spiller skal ikke se en bryter med ett valg.
  const d = bekreftet([], null, null)
  assert.equal(d.visSkinne, false)
  assert.equal(d.scope, 'global')
  assert.equal(d.ramme, 'global')
})

test('gjest ⇒ ingen skinne, ingen org-valg', () => {
  // Utlogget er et BEKREFTET svar i ProfileProvider: myOrgs=[] og
  // myOrgsLoaded=true. Gjesten kan derfor ikke havne i ventetilstand.
  const d = decideTopplisteScope({
    scopeParam: 'organization', scopeIdParam: 'org-a',
    myOrgs: [], myOrgsLoaded: true, myOrgsError: false,
  })
  assert.equal(d.visSkinne, false)
  assert.equal(d.scope, 'global', 'en gjest skal aldri be om org-data — ruten svarer 401')
  assert.equal(d.venter, false, 'gjesten må ikke bli stående i ventetilstand')
  assert.equal(d.ryddUrl, true, 'URL-en ryddes, ellers står org-overskriften over globale tall')
})

test('én org ⇒ skinne med to valg (Alle + bedriften)', () => {
  const d = bekreftet([A], null, null)
  assert.equal(d.visSkinne, true)
  // Antall knapper er 1 + myOrgs.length; beslutningen bærer flagget, siden
  // rendrer listen. Se strukturtesten nederst for selve tellingen.
  assert.equal(d.scope, 'global', 'uten scope-parameter er global default')
})

test('to org-er ⇒ skinne, og hver av dem kan velges', () => {
  assert.equal(bekreftet([A, B], null, null).visSkinne, true)
  const valgtA = bekreftet([A, B], 'organization', 'org-a')
  const valgtB = bekreftet([A, B], 'organization', 'org-b')
  assert.deepEqual(
    [valgtA.scope, valgtA.valgtOrgId, valgtB.scope, valgtB.valgtOrgId],
    ['organization', 'org-a', 'organization', 'org-b']
  )
})

// ── URL-en valideres mot medlemskapene ──────────────────────────────────────

test('egen org i URL ⇒ organization-scope og org-ramme', () => {
  const d = bekreftet([A], 'organization', 'org-a')
  assert.equal(d.scope, 'organization')
  assert.equal(d.valgtOrgId, 'org-a')
  assert.equal(d.ramme, 'organization')
  assert.equal(d.ryddUrl, false)
})

test('FREMMED org i URL ⇒ global, og URL-en ryddes — ingen 403', () => {
  // Kjernen. Gaten ville svart 403, og 403-grenen i SeasonLeaderboard sier
  // «Noe gikk galt. Prøv å laste siden på nytt» — et råd som aldri kan hjelpe,
  // fordi ingen omlasting gjør deg til medlem. Vi sender derfor aldri kallet.
  const d = bekreftet([A], 'organization', 'org-fremmed')
  assert.equal(d.scope, 'global')
  assert.equal(d.ramme, 'global', 'overskriften må ikke love en bedriftsliste vi ikke viser')
  assert.equal(d.ryddUrl, true)
  assert.equal(d.venter, false)
})

test('scope=organization uten scope_id ⇒ global, ingen rydding', () => {
  const d = bekreftet([A], 'organization', null)
  assert.equal(d.scope, 'global')
  assert.equal(d.ryddUrl, false, 'det er ingenting å rydde — parameteren var aldri komplett')
})

test('ukjent scope-verdi ignoreres', () => {
  assert.equal(bekreftet([A], 'league', 'org-a').scope, 'global')
  assert.equal(bekreftet([A], 'tull', 'org-a').scope, 'global')
})

// ── «Vet ikke» er to ulike tilstander, og ingen av dem er «ikke medlem» ─────

test('medlemskapene har ikke landet ⇒ venter, med ORG-ramme', () => {
  // Alternativet var å vise global først og bytte når svaret kom: feil liste
  // under feil overskrift i et halvt sekund, pluss en henting vi kaster.
  const d = decideTopplisteScope({
    scopeParam: 'organization', scopeIdParam: 'org-a',
    myOrgs: [], myOrgsLoaded: false, myOrgsError: false,
  })
  assert.equal(d.venter, true)
  assert.equal(d.ramme, 'organization', 'rammen følger det URL-en ba om mens vi venter')
  assert.equal(d.ryddUrl, false, 'vi konkluderer ikke før svaret er inne')
})

test('hentingen FEILET ⇒ global, men URL-en ryddes IKKE', () => {
  // Et feilsvar er ikke bevis på at brukeren ikke er medlem
  // (lib/fetch-result.ts-regelen). Men vi kan heller ikke vente evig — uten
  // denne grenen står en bokmerket org-lenke fast på «Henter bedriften din …»
  // for alltid. Utfallet er degradert, men SANT: global liste, global
  // overskrift, og brukerens eget valg blir stående i URL-en.
  const d = decideTopplisteScope({
    scopeParam: 'organization', scopeIdParam: 'org-a',
    myOrgs: [], myOrgsLoaded: false, myOrgsError: true,
  })
  assert.equal(d.venter, false, 'en feil må ikke gi evig venting')
  assert.equal(d.scope, 'global')
  assert.equal(d.ramme, 'global', 'rammen må ikke love bedriftens liste når vi viser den globale')
  assert.equal(d.ryddUrl, false, 'en feil er ikke bevis på manglende medlemskap')
})

test('feil ETTER at en gyldig org er kjent ⇒ org-scope beholdes', () => {
  // ProfileProvider beholder en tidligere bekreftet liste ved transient feil.
  // Da skal brukeren bli stående i bedriftens visning.
  const d = decideTopplisteScope({
    scopeParam: 'organization', scopeIdParam: 'org-a',
    myOrgs: [A], myOrgsLoaded: true, myOrgsError: true,
  })
  assert.equal(d.scope, 'organization')
  assert.equal(d.valgtOrgId, 'org-a')
})

// ── Koblingen i siden ───────────────────────────────────────────────────────

const SIDE = 'app/toppliste/page.tsx'
const KOMPONENT = 'components/SeasonLeaderboard.tsx'
const RUTE = 'app/api/toppliste/route.ts'

function aktivKode(fil: string): string {
  const raw = readFileSync(fil, 'utf8')
  const utenBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

test('siden bruker den rene beslutningen, ikke sin egen inline-logikk', () => {
  const src = aktivKode(SIDE)
  assert.match(src, /import \{ decideTopplisteScope \} from '@\/lib\/toppliste-scope'/)
  assert.match(src, /const beslutning = decideTopplisteScope\(\{/)
})

test('H1 følger scopet — «Bedriftens toppliste» i org-visning', () => {
  const src = aktivKode(SIDE)
  assert.match(src, /visOrgRamme[\s\S]{0,120}Bedriftens <em[^>]*>toppliste<\/em>/,
    'org-grenen av H1-en mangler')
  assert.match(src, /Topp<em[^>]*>listen<\/em>/, 'global-grenen av H1-en mangler')
  assert.match(src, /const visOrgRamme = beslutning\.ramme === 'organization'/,
    'overskriften er ikke lenger bundet til beslutningens ramme')
})

test('undertittelen bytter FELT, ikke verb', () => {
  // Dennis' valg 6. september 2026: «dominerer» er husets ord for det lista
  // måler og skal stå fast i begge scope. Bare feltet endrer seg. Et verb som
  // skifter med scopet ville fått to visninger av de samme tallene til å låte
  // som to ulike funksjoner.
  const src = aktivKode(SIDE)
  assert.match(src, /'Hvem dominerer blant kollegene\?' : 'Hvem dominerer over tid\?'/,
    'undertittelen følger ikke lenger mønsteret «samme verb, nytt felt»')
  const undertittelLinje = src.split('\n').find(l => l.includes('Hvem dominerer')) ?? ''
  const verbTreff = undertittelLinje.match(/dominerer/g) ?? []
  assert.equal(verbTreff.length, 2, 'begge grenene skal bruke verbet «dominerer»')
})

test('skinnen rendres kun når beslutningen sier det, med ett valg per org', () => {
  const src = aktivKode(SIDE)
  assert.match(src, /\{visSkinne && \(/, 'skinnen er ikke lenger gatet på visSkinne')
  assert.match(src, /const visSkinne = beslutning\.visSkinne/)
  // «Alle» + én knapp per medlemskap ⇒ 1 org gir to valg, 2 org-er gir tre.
  assert.match(src, /onClick=\{\(\) => settScope\(null\)\}/, '«Alle»-valget mangler')
  // Kroppen ble `{ … }` i stedet for `( … )` da bryteren fikk en `aktiv`-
  // variabel per valg (segmentert kontroll, 6. september 2026). Ankeret
  // godtar begge formene, siden det er KILDEN til valgene som voktes her —
  // ikke hvordan pilfunksjonen er skrevet.
  assert.match(src, /myOrgs\.map\(o => [({][\s\S]{0,600}onClick=\{\(\) => settScope\(o\.orgId\)\}/,
    'org-valgene rendres ikke fra myOrgs')
  assert.match(src, /\{o\.orgName\}/, 'org-valget viser ikke navnet — «Bedriften» er tvetydig med to medlemskap')
})

test('scope og periode er uavhengige akser i URL-en', () => {
  // «scope overlever periodebytte»: SeasonLeaderboards updateQuery PATCHER
  // eksisterende parametere i stedet for å bygge en ny streng, så ukjente
  // nøkler (scope, scope_id) blir stående.
  const komp = aktivKode(KOMPONENT)
  assert.match(komp, /const params = new URLSearchParams\(searchParams\.toString\(\)\)/,
    'updateQuery bygger ikke lenger videre på eksisterende parametere — scope ville gått tapt ved periodebytte')
  // «periode overlever scopebytte»: settScope rører ikke period.
  const src = aktivKode(SIDE)
  const settScope = src.slice(src.indexOf('const settScope'), src.indexOf('const visSkinne'))
  assert.ok(!settScope.includes("delete('period')"), 'settScope sletter period — periodevalget ville gått tapt ved scopebytte')
  assert.ok(settScope.includes("delete('hist')") && settScope.includes("delete('histKey')"),
    'settScope må rydde hist/histKey — de peker på en åpnet rad i det GAMLE feltet')
})

test('scope-spesifikke cacher nullstilles ved scopebytte', () => {
  // Uten scope/scopeId i dep-arrayen ble bedriftens historikk stående synlig
  // etter bytte til den offentlige lista: riktig overskrift, feil tall under.
  // Bit-identisk for /org og /liga, som sender konstante props.
  const komp = aktivKode(KOMPONENT)
  assert.match(komp, /\}, \[period, scope, scopeId\]\)/,
    'reset-effekten avhenger ikke lenger av scope — historikk fra forrige felt blir stående')
})

// ── Tilgang og premiumView er URØRT ─────────────────────────────────────────

test('premiumView-regelen står nøyaktig som før', () => {
  const rute = aktivKode(RUTE)
  assert.match(rute, /const premiumView = userIsPremium \|\| isClosedRoom\(scope\)/,
    'premiumView er endret — regelen skulle stå urørt')
})

test('klienten gjør ingen egen tilgangsvurdering', () => {
  // Gaten er serverens. Skulle siden eller komponenten begynne å avgjøre hvem
  // som får se hva, ville de to kildene kunne bli uenige — og klientens svar
  // er alltid det som kan omgås.
  //
  // MÅLES PÅ SIDEKOMPONENTEN, ikke på hele fila. `PlacementLockedBanner`
  // lenger oppe leser `isPremium` fra før, og det er legitimt: den avgjør om
  // et informasjonsbanner skal vises, ikke hvem som får hvilke data. Et
  // fil-bredt søk ville felt den uskyldige og gjort testen umulig å holde
  // grønn — altså rød av feil grunn.
  const src = aktivKode(SIDE)
  const sideKropp = src.slice(src.indexOf('export default function TopplisterPage'))
  assert.ok(sideKropp.length > 0, 'fant ikke sidekomponenten')
  for (const forbudt of ['isPremium', 'premiumView', 'isClosedRoom']) {
    assert.ok(!sideKropp.includes(forbudt),
      `scope-bryteren refererer «${forbudt}» — tilgang og detaljgrad avgjøres i /api/toppliste, ikke her`)
  }
})

test('/api/toppliste har ingen scope-bryter-spesifikk kode', () => {
  // Bryteren skulle ikke koste én linje i ruten. Dukker det opp en referanse
  // til bryterens egne begreper her, har grensen sklidd.
  const rute = aktivKode(RUTE)
  for (const forbudt of ['decideTopplisteScope', 'visSkinne', 'ryddUrl']) {
    assert.ok(!rute.includes(forbudt), `${RUTE} kjenner til bryteren («${forbudt}») — ruten skulle være urørt`)
  }
})
