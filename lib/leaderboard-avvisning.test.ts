// Kjøres med:  npm test
//
// Tre tilstander, tre svar (6. september 2026). Fram til nå kollapset
// SeasonLeaderboard alle avviste svar til én boolsk `loadError`, og valgte
// tekst ut fra om det fantes en sesjon. Da fikk en ikke-medlem «Prøv å laste
// siden på nytt» — et råd ingen omlasting kan innfri — og en anonym bruker med
// en 500-feil fikk «Logg inn», som heller ikke hjelper.
//
// Samme feilklasse som c4e808e løste i questions-ruta: et utfallsrom som er
// smalere enn virkeligheten gjør diagnosen umulig.
//
// HVER GREN TESTES FOR SEG, og mutasjonsrunden slår sammen to grener om
// gangen: kollapser to utfall til ett, skal nøyaktig én test bli rød.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { klassifiserAvvisning, velgTomSkjerm, ikkeMedlemTekst } from './leaderboard-avvisning'

// ── Statuskode → årsak ──────────────────────────────────────────────────────

test('401 er «uinnlogget» — og ingenting annet er det', () => {
  assert.equal(klassifiserAvvisning(401), 'uinnlogget')
  for (const status of [400, 403, 404, 429, 500, 503]) {
    assert.notEqual(klassifiserAvvisning(status), 'uinnlogget', `${status} skal ikke lese som uinnlogget`)
  }
})

test('403 er «ikke-medlem» — og ingenting annet er det', () => {
  assert.equal(klassifiserAvvisning(403), 'ikke-medlem')
  for (const status of [400, 401, 404, 429, 500, 503]) {
    assert.notEqual(klassifiserAvvisning(status), 'ikke-medlem', `${status} skal ikke lese som ikke-medlem`)
  }
})

test('alt annet er «feil» — der ER «prøv igjen» riktig råd', () => {
  for (const status of [400, 404, 409, 429, 500, 502, 503]) {
    assert.equal(klassifiserAvvisning(status), 'feil', `${status} skal lese som en ekte feil`)
  }
})

test('400 «Ugyldig scope» havner i «feil», ikke i medlemskap', () => {
  // Ruten svarer 400 kun ved en programmeringsfeil hos oss. Å fortelle
  // brukeren noe om medlemskap da ville vært en gjetning forkledd som svar.
  assert.equal(klassifiserAvvisning(400), 'feil')
})

// ── Årsak → skjerm ──────────────────────────────────────────────────────────

test('hver årsak får sin EGEN skjerm', () => {
  assert.equal(velgTomSkjerm('uinnlogget'), 'logg-inn')
  assert.equal(velgTomSkjerm('ikke-medlem'), 'ikke-medlem')
  assert.equal(velgTomSkjerm('feil'), 'feil')
})

test('de tre skjermene er innbyrdes FORSKJELLIGE', () => {
  // Selve poenget med saken. Kollapser to av dem til samme verdi, er vi
  // tilbake til «tre tilstander, ett svar».
  const skjermer = [velgTomSkjerm('uinnlogget'), velgTomSkjerm('ikke-medlem'), velgTomSkjerm('feil')]
  assert.equal(new Set(skjermer).size, 3, `to eller flere årsaker deler skjerm: ${skjermer.join(', ')}`)
})

test('ingen avvisning ⇒ den nøytrale tomme skjermen, uendret fra før', () => {
  assert.equal(velgTomSkjerm(null), 'ingen-data')
})

test('sesjonstilstanden er IKKE med i beslutningen', () => {
  // Regresjonsvakt mot det gamle designet. `velgTomSkjerm` tar ett argument;
  // får den flere, er sesjonsgjettingen på vei inn igjen.
  assert.equal(velgTomSkjerm.length, 1,
    'velgTomSkjerm har fått flere parametere — statusen vet, sesjonen gjetter')
})

// ── «Ikke medlem» av HVA ────────────────────────────────────────────────────

test('substantivet følger scopet', () => {
  assert.equal(ikkeMedlemTekst('organization'), 'Du er ikke medlem av denne bedriften.')
  assert.equal(ikkeMedlemTekst('league'), 'Du er ikke medlem av denne ligaen.')
})

test('org-teksten er ORDRETT den /org/[slug] allerede bruker', () => {
  // Gjenbruk, ikke oppfinnelse. Driver de to fra hverandre, sier appen to
  // ting om samme situasjon.
  const orgSide = readFileSync('app/org/[slug]/page.tsx', 'utf8')
  assert.ok(
    orgSide.includes(ikkeMedlemTekst('organization')),
    'ordlyden finnes ikke lenger i app/org/[slug]/page.tsx — de to har driftet fra hverandre'
  )
})

test('global scope påstår ingenting om bedrift eller liga', () => {
  // Global har ingen medlemskapsgate og kan ikke gi 403. Skulle det likevel
  // skje, er en nøytral formulering riktigere enn en oppdiktet tilhørighet.
  const tekst = ikkeMedlemTekst('global')
  assert.ok(!tekst.includes('bedrift') && !tekst.includes('liga'), `global-teksten påstår tilhørighet: «${tekst}»`)
})

// ── Koblingen i komponenten ─────────────────────────────────────────────────

const KOMP = 'components/SeasonLeaderboard.tsx'

function aktivKode(fil: string): string {
  const raw = readFileSync(fil, 'utf8')
  const utenBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

test('komponenten bærer statusen videre i stedet for en boolsk verdi', () => {
  const src = aktivKode(KOMP)
  assert.match(src, /setAvvisning\(klassifiserAvvisning\(res\.status\)\)/,
    'statuskoden kastes — da er årsaken tapt før noen kan vise den')
  assert.ok(!/setLoadError/.test(src), 'den gamle boolske loadError er tilbake på en aktiv linje')
})

test('nettverksfeil (ingen status) klassifiseres som ekte feil', () => {
  const src = aktivKode(KOMP)
  const catchBlokk = src.slice(src.indexOf('} catch {'), src.indexOf('} finally {'))
  assert.match(catchBlokk, /setAvvisning\('feil'\)/,
    'catch-grenen setter ikke «feil» — et nettverksbrudd har ingen status å lese')
})

test('visningen velger skjerm fra avvisningen, ikke fra sesjonen', () => {
  const src = aktivKode(KOMP)
  assert.match(src, /const skjerm = velgTomSkjerm\(avvisning\)/)
  assert.ok(
    !/const showError = .*session/.test(src),
    'den gamle sesjonsbaserte gjetningen er tilbake'
  )
})

test('alle fire skjermene rendres, hver med sin egen tekst', () => {
  const src = aktivKode(KOMP)
  for (const [gren, tekst] of [
    ["skjerm === 'feil'", 'Noe gikk galt. Prøv å laste siden på nytt.'],
    ["skjerm === 'ikke-medlem'", 'Ingen tilgang'],
    ["skjerm === 'logg-inn'", 'Logg inn for å se denne listen'],
    ['', 'Ingen data ennå'],
  ] as const) {
    if (gren) assert.ok(src.includes(gren), `grenen ${gren} mangler`)
    assert.ok(src.includes(tekst), `teksten «${tekst}» mangler`)
  }
  // «Ingen tilgang»-skjermen skal IKKE tilby en handling: verken omlasting
  // eller innlogging endrer medlemskap.
  const start = src.indexOf("skjerm === 'ikke-medlem'")
  const slutt = src.indexOf("skjerm === 'logg-inn'")
  const gren = src.slice(start, slutt)
  assert.ok(!gren.includes('<Link'), 'ikke-medlem-skjermen tilbyr en lenke — det finnes ingen handling som hjelper')
})
