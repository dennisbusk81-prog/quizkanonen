// Kjøres med:  npm test
//
// ANONYM FORSIDE — synlig vei til topplista og arkivet (9. september 2026).
//
// Kartleggingen samme dag fant at den ANONYME grenen av app/page.tsx ikke
// hadde noen lenke til /toppliste eller /arkiv i innholdet. «Månedens
// toppliste» i quizkortet var en overskrift uten lenke, og eneste vei var
// hamburgeren i navlinja. Fredagstrafikken fra Facebook-gruppa lander
// uinnlogget på forsiden.
//
// Filen deler app/page.tsx i de to grenene komponenten faktisk returnerer.
// SHARED_CSS settes inn nøyaktig én gang per gren, som første element i
// hver return: innlogget = fra første til andre innsetting, anonym = fra
// andre og ut. <WelcomeBanner rendres kun i den anonyme grenen (én
// forekomst) og brukes som kontroll på at delingen traff — den står FEM
// linjer etter grenens SHARED_CSS, så den kan ikke selv være delepunktet.
//
// HVA SOM MANGLET FØRST (70134f9 → oppfølgingen samme kveld): første
// versjon la raden under quiz-kortet og testen krevde bare at lenkene
// FANTES i grenen. De fantes — 2108 px ned på mobil, 2,5 skjermhøyder,
// fordi kortet er femte seksjon for utloggede. Testen «rekkefølge …»
// under krever derfor at raden står FØR «Steg 1»-blokken i kildeteksten,
// altså i hero-en, den ene flaten alle ser uten å scrolle. Kildetekst-
// rekkefølge er ikke pikselposisjon, men hero-en er første seksjon i
// grenen, så «før Steg 1» er det nærmeste en strukturtest kommer «synlig
// ved ankomst». Selve bredden (155 av 312 px ved 360) måles i nettleser.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes lenken under topp 3 i «Åpen nå»-kortet, ryker «åpen quiz …».
//   • Fjernes /arkiv-lenken i hero-raden, ryker «arkivet …».
//   • Fjernes /toppliste-lenken i hero-raden, ryker «topplista …».
//   • Flyttes raden ned under quiz-kortet igjen, ryker «rekkefølge …».
//   • Havner en av lenkene i den INNLOGGEDE grenen i stedet, ryker
//     «innlogget gren er uendret» — den teller de to topplistelenkene den
//     grenen hadde fra før, og krever null arkivlenker der.
//
// Kommentarer strippes før telling, ellers kan en kommentar som siterer
// attributtet holde testen grønn med lenken fjernet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const RAW = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8')

function utenKommentarer(kilde: string): string {
  return kilde
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

const PAGE = utenKommentarer(RAW)
const STYLE = '<style>{SHARED_CSS}</style>'
const BANNER = '<WelcomeBanner'

const forsteStyle = PAGE.indexOf(STYLE)
const andreStyle = PAGE.indexOf(STYLE, forsteStyle + 1)
const banner = PAGE.indexOf(BANNER)
const INNLOGGET = PAGE.slice(forsteStyle, andreStyle)
const ANONYM = PAGE.slice(andreStyle)

const TOPPLISTE = 'href="/toppliste"'
const ARKIV = 'href="/arkiv"'

function tell(kilde: string, naal: string): number {
  return kilde.split(naal).length - 1
}

test('ankrene som deler grenene står der de skal', () => {
  assert.ok(forsteStyle >= 0 && andreStyle > forsteStyle, 'SHARED_CSS settes inn to ganger, én per gren')
  assert.equal(tell(PAGE, STYLE), 2, 'nøyaktig to SHARED_CSS-innsettinger')
  assert.equal(tell(PAGE, BANNER), 1, '<WelcomeBanner rendres nøyaktig én gang (kun anonym gren)')
  assert.ok(banner > andreStyle, '<WelcomeBanner ligger i den anonyme grenen — delingen traff')
  assert.equal(tell(INNLOGGET, BANNER), 0, 'innlogget gren har ingen WelcomeBanner')
})

test('åpen quiz: topplistelenken står rett under topp 3 i den anonyme «Åpen nå»-kortet', () => {
  const overskrift = ANONYM.indexOf('Månedens toppliste')
  assert.ok(overskrift >= 0, 'den anonyme grenen har «Månedens toppliste»')
  const handlinger = ANONYM.indexOf('className="qk-card-actions"', overskrift)
  assert.ok(handlinger > overskrift, 'kortet har en handlingsrad etter overskriften')
  const blokk = ANONYM.slice(overskrift, handlinger)
  assert.equal(tell(blokk, TOPPLISTE), 1, 'nøyaktig én lenke til /toppliste mellom overskriften og handlingsraden')
  assert.ok(blokk.includes('Se hele topplisten →'), 'lenketeksten sier hva som ligger bak')
})

test('arkivet: den anonyme grenen lenker til /arkiv i hero-raden', () => {
  const rad = ANONYM.indexOf('Quizarkiv →')
  assert.ok(rad >= 0, 'hero-raden finnes')
  assert.equal(tell(ANONYM, ARKIV), 1, 'nøyaktig én lenke til /arkiv i den anonyme grenen')
  const lenke = ANONYM.lastIndexOf(ARKIV, rad)
  assert.ok(lenke >= 0 && rad - lenke < 200, 'lenken sitter på «Quizarkiv →», ikke et annet sted')
})

test('topplista: hero-raden lenker til /toppliste, ubetinget', () => {
  const rad = ANONYM.indexOf('Toppliste →')
  assert.ok(rad >= 0, 'raden har «Toppliste →»')
  const lenke = ANONYM.lastIndexOf(TOPPLISTE, rad)
  assert.ok(lenke >= 0 && rad - lenke < 200, 'lenken sitter på «Toppliste →»')
  const radStart = ANONYM.lastIndexOf('<div', lenke)
  const foran = ANONYM.slice(radStart, lenke)
  assert.ok(!foran.includes('&& ('), 'ingen vakt mellom radens div og lenken — begge lenker vises alltid')
})

test('rekkefølge: hero-raden står FØR første «Steg 1»-blokk — synlig uten å scrolle', () => {
  const steg1 = ANONYM.indexOf('Steg 1')
  assert.ok(steg1 >= 0, 'den anonyme grenen har «Steg 1»-blokken')
  const arkiv = ANONYM.indexOf('Quizarkiv →')
  const toppliste = ANONYM.indexOf('Toppliste →')
  assert.ok(arkiv >= 0 && arkiv < steg1, '«Quizarkiv →» kommer før «Steg 1» i kildeteksten')
  assert.ok(toppliste >= 0 && toppliste < steg1, '«Toppliste →» kommer før «Steg 1» i kildeteksten')
  const heroSlutt = ANONYM.indexOf('</section>')
  assert.ok(heroSlutt > arkiv && heroSlutt > toppliste, 'raden ligger inne i hero-seksjonen')
})

test('innlogget gren er uendret: to topplistelenker som før, ingen arkivlenke', () => {
  assert.equal(tell(INNLOGGET, TOPPLISTE), 2, 'innlogget forside hadde to lenker til /toppliste før 9. september (plasseringslenke + snarvei-kort)')
  assert.equal(tell(INNLOGGET, ARKIV), 0, 'innlogget forside lenket ikke til /arkiv før 9. september')
})
