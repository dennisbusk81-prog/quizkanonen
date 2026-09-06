// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: hvilke KONTROLLER en rad rendrer på /quizer og /arkiv,
// og hvilken id resultatlenken peker på.
//
// ── HVILKE FEIL DENNE FILEN FINNES FOR ──────────────────────────────────────
//
// A) BLINDVEIEN PÅ /quizer (fjernet 6. september 2026).
//    Kortet rendret `status !== 'kommende' && <Link href={/quiz/<id>}>` med
//    teksten «Spill nå» på åpne og «Se quiz» på STENGTE rader. På en stengt
//    quiz rendrer spillsiden kun en utgang til /leaderboard — altså nøyaktig
//    dit «Resultater →» i samme rad allerede gikk. To kontroller, én
//    endestasjon, den ene med et unødvendig mellomsteg.
//    Kontrollen ble FJERNET, ikke omdirigert: hadde «Se quiz» i stedet pekt på
//    /leaderboard, ville raden fått to lenker til samme sted med ulike navn —
//    den samme feilen, penere skrevet.
//
// B) ARKIVRADEN MANGLET VEI TIL RESULTATENE (lagt til 6. september 2026).
//    «Spill noe nå» og «hvordan gikk det» er to ærend, men de møtes på samme
//    rad. Kryssnavigasjonen er én lenke hver vei; dette er veien arkiv →
//    resultater.
//
//    TO TING SOM MÅ HOLDE, og som hver har sin egen test under:
//      • Lenken står UTENFOR kanSpille/laast-grenene. Resultatsiden er ikke
//        premium-gatet — den gater seg selv (gjest ser topp 3, eksakt
//        plassering krever Premium). Havner lenken inne i en gren, forsvinner
//        den for gjest og gratisbruker, altså for de to gruppene som har mest
//        bruk for å se hva de gikk glipp av.
//      • Lenken peker på KILDEQUIZENS id (`quiz.id`), ikke på en kopi. Radene
//        i /arkiv-lista ER originalene; kopien «Spill» oppretter finnes ikke
//        ennå, og en arkivkopi har uansett ingen offentlig resultatliste —
//        spilleren er alene på den. En kopi-id her gir en tom eller ugyldig
//        side.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/kontomeny-arkivlenke.test.ts og lib/historikk-arkivlenke-wiring.test.ts
// — npm test kjører kun lib/**/*.test.ts under Node sin egen runner, uten
// jsdom, og begge flatene er React-komponenter.
//
// ── KOMMENTARER MÅ STRIPPES ─────────────────────────────────────────────────
// Begge filene forklarer i prosa hvorfor kontrollene ser ut som de gjør, og
// siterer derfor de FJERNEDE strengene ordrett («Se quiz», `status !==
// 'kommende'`). En naiv tekstsjekk ville lest kommentaren som kode og meldt
// blindveien som gjeninnført. `aktivKode()` fjerner blokk-, linje- og
// JSX-kommentarer FØR noe måles, og testen «strippingen virker begge veier»
// nederst beviser at den faktisk gjør det — ellers ville fraværstestene vært
// grønne av feil grunn.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const QUIZER = 'app/quizer/page.tsx'
const ARKIV = 'app/arkiv/page.tsx'

/**
 * Kilden uten BOM og uten kommentarer.
 *
 * Rekkefølgen er nøye: JSX-kommentarer (`{@literal {}/* … *␝/}`) fjernes som
 * blokkommentarer, og linjekommentarer fjernes kun når linja BEGYNNER med
 * `//`, slik at en `//` inne i en URL-streng ikke spiser resten av linja.
 */
function aktivKode(fil: string): string {
  const raw = readFileSync(fil, 'utf8')
  const utenBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

// ── A: /quizer — spill-knappen kun på ÅPEN rad ──────────────────────────────

test('A: /quizer rendrer spill-lenken kun når status er «åpen»', () => {
  const src = aktivKode(QUIZER)
  assert.match(
    src,
    /\{status === 'åpen' && \(\s*<Link href=\{`\/quiz\/\$\{quiz\.id\}`\} className="qz-btn-outline">/,
    'spill-lenken på /quizer er ikke lenger gatet på status === «åpen»'
  )
})

test('A: den gamle blindvei-betingelsen finnes ikke på en aktiv linje', () => {
  // `status !== 'kommende'` slapp BÅDE åpne og stengte rader gjennom. Det var
  // nøyaktig den betingelsen som ga stengte rader en knapp til ingensteds.
  const src = aktivKode(QUIZER)
  assert.ok(
    !src.includes("status !== 'kommende'"),
    "blindvei-betingelsen `status !== 'kommende'` er tilbake på en aktiv linje i " + QUIZER
  )
})

test('A: etiketten «Se quiz» finnes ikke lenger som kontroll', () => {
  // Teksten fantes kun i den fjernede grenen. Dukker den opp igjen, er enten
  // knappen gjeninnført eller en ny kontroll har arvet navnet.
  const src = aktivKode(QUIZER)
  assert.ok(!src.includes('Se quiz'), 'etiketten «Se quiz» er tilbake i ' + QUIZER)
})

test('A: «Resultater →» står igjen på ALLE rader, uansett status', () => {
  // Fjerningen over er kun forsvarlig fordi resultatlenken er UGATET. Havner
  // den bak en status-sjekk, mister en stengt rad sin ENESTE kontroll — og da
  // har fiksen gjort flaten verre enn blindveien den erstattet.
  //
  // MÅLES PÅ HALEN, ikke på en linje som nevner klassenavnet. Første forsøk
  // slo opp «første linje som inneholder qz-btn-ghost» og traff
  // CSS-DEFINISJONEN `.qz-btn-ghost { … }` i style-blokken lenger oppe i fila.
  // Den linja nevner selvsagt aldri `status`, så testen var grønn uansett hva
  // JSX-en gjorde: en mutasjon som gatet lenken på status overlevde. Naboen
  // oppfylte ankeret.
  const src = aktivKode(QUIZER)
  const start = src.indexOf("{status === 'åpen' && (")
  assert.ok(start > -1, 'fant ikke status-grenen i ' + QUIZER)
  const grenSlutt = src.indexOf(')}', start)
  assert.ok(grenSlutt > -1, 'status-grenen har endret form — les testen på nytt før du «fikser» den')
  const etterGren = src.slice(grenSlutt + ')}'.length)
  const divSlutt = etterGren.indexOf('</div>')
  assert.ok(divSlutt > -1, 'fant ikke slutten på qz-card-right')
  const halen = etterGren.slice(0, divSlutt).replace(/\{\}/g, '').trim()
  assert.equal(
    halen,
    '<Link href={`/leaderboard/${quiz.id}`} className="qz-btn-ghost">Resultater →</Link>',
    'halen av qz-card-right er ikke KUN den ugatede resultatlenken. Får den en betingelse, ' +
      'står en stengt rad uten en eneste kontroll.'
  )
})

// ── B: /arkiv — resultatlenke på hver rad, i alle tre tilstandene ───────────

test('B: arkivraden har en resultatlenke', () => {
  const src = aktivKode(ARKIV)
  assert.match(
    src,
    /<a href=\{`\/leaderboard\/\$\{quiz\.id\}`\} style=\{s\.resultatLenke\}>Resultater →<\/a>/,
    'resultatlenken mangler i arkivraden'
  )
})

test('B: lenken peker på KILDEQUIZENS id, ikke en kopi', () => {
  // `quiz.id` er raden i /api/arkiv-lista, altså originalen. Enhver annen
  // variabel her (kopiens id fra POST-svaret, et attempt, en json.quizId)
  // ville gitt en side uten offentlig resultatliste.
  const src = aktivKode(ARKIV)
  const lenker = src.match(/href=\{`\/leaderboard\/\$\{[^}]+\}`\}/g) ?? []
  assert.deepEqual(
    lenker,
    ['href={`/leaderboard/${quiz.id}`}'],
    'arkivraden har en /leaderboard-lenke som ikke bruker quiz.id — kopi-id gir tom resultatside'
  )
})

test('B: lenken er UGATET — ingen betingelse mellom grenen og </div>', () => {
  // Den strukturelle kjernen i B, og den må måles på HALEN, ikke på posisjon.
  // En posisjonstest («lenken står etter `) : null}`») ville sluppet gjennom
  // `{kanSpille && <a …>}` skrevet ETTER grenen — som gjør lenken
  // Premium-only, altså nøyaktig feilen testen finnes for.
  //
  // Derfor: alt mellom slutten på kanSpille/laast-grenen og `</div>` skal
  // være anker-elementet og whitespace. Ingenting annet. Enhver gate, uansett
  // form (`&&`, ternær, ny variabel), legger igjen tegn som ikke matcher.
  const src = aktivKode(ARKIV)
  const start = src.indexOf('{kanSpille ? (')
  assert.ok(start > -1, 'fant ikke kanSpille-grenen i ' + ARKIV)
  const grenSlutt = src.indexOf(') : null}', start)
  assert.ok(grenSlutt > -1, 'kanSpille-grenen har endret form — les testen på nytt før du «fikser» den')
  const etterGren = src.slice(grenSlutt + ') : null}'.length)
  const divSlutt = etterGren.indexOf('</div>')
  assert.ok(divSlutt > -1, 'fant ikke slutten på rowRight')
  // `{}` er residuet etter en strippet JSX-kommentar (`aktivKode` fjerner
  // innmaten, klammene balanserer og blir stående). Det er en inert JSX-child
  // som ikke rendrer noe, og det er nettopp SLIK kommentaren over lenken ser
  // ut etter stripping. En ekte gate etterlater aldri bare `{}` — den
  // etterlater `{kanSpille && …}` — så å normalisere bort tomme klammer
  // svekker ikke testen. Uten dette var testen rød på et korrekt kildetre,
  // altså rød av feil grunn.
  const halen = etterGren.slice(0, divSlutt).replace(/\{\}/g, '').trim()
  assert.equal(
    halen,
    '<a href={`/leaderboard/${quiz.id}`} style={s.resultatLenke}>Resultater →</a>',
    'halen av rowRight er ikke KUN den ugatede resultatlenken. Står det en betingelse der ' +
      '(f.eks. `{kanSpille && …}`), blir lenken usynlig for gjest og gratisbruker — de to ' +
      'gruppene den er mest verdt for, siden resultatsiden ikke er premium-gatet.'
  )
})

test('B: rowRight legger de to kontrollene ved siden av hverandre', () => {
  // Uten flex stables knappen og lenken, og raden blir dobbelt så høy.
  const src = aktivKode(ARKIV)
  assert.match(src, /rowRight: \{ flexShrink: 0, display: 'flex'/, 'rowRight er ikke lenger en flex-rad')
})

test('B: resultatlenken bruker brødtekstfargen, ikke gull', () => {
  // Husregelen: lenker som ikke er primærhandlinger er #e8e4dd. «Spill» er
  // radens handling; resultatene er sekundære her.
  const src = aktivKode(ARKIV)
  assert.match(src, /resultatLenke: \{[^}]*color: '#e8e4dd'/, 'resultatlenken har byttet farge')
})

// ── C: hamburgergrensen ─────────────────────────────────────────────────────

test('C: hamburgergrensen står på 899px', () => {
  // 899 er valgt fordi SiteNav sin innerStyle har max-width 900: under 900
  // følger beholderen viewporten, ved 900 og oppover står den fast. 900 er
  // derfor den eneste grensen der «får plass ved grensen» også betyr «får
  // plass på hver bredere skjerm». Full begrunnelse står i NavAuth.tsx.
  const nav = aktivKode('components/NavAuth.tsx')
  assert.match(nav, /@media \(max-width: 899px\) \{/, 'hamburgergrensen er endret')
  assert.ok(
    !nav.includes('max-width: 639px'),
    'den gamle 639px-grensen er tilbake — da ser org-brukere en halv rad igjen'
  )
})

test('C: grensen matcher beholderens max-width', () => {
  // Koblingen 899 ↔ 900 er hele begrunnelsen. Endres max-width i SiteNav uten
  // at grensen følger etter, mister valget sitt grunnlag.
  const siteNav = aktivKode('components/SiteNav.tsx')
  assert.match(siteNav, /maxWidth: 900,/, 'innerStyle sin maxWidth er ikke lenger 900 — hamburgergrensen (899) må følge etter')
})

// ── Beviset på at strippingen virker BEGGE veier ────────────────────────────

test('aktivKode fjerner kommentarer, men ikke kode', () => {
  // Uten dette kan fraværstestene over være grønne fordi strippingen spiser
  // for mye — eller røde fordi den spiser for lite. Begge retninger felles her.
  const medBlokk = "const a = 1\n/* status !== 'kommende' */\nconst b = 2"
  const medJsx = "const a = 1\n{/* Se quiz */}\nconst b = 2"
  const medLinje = "const a = 1\n// Se quiz\nconst b = 2"
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  for (const [navn, kilde] of [['blokk', medBlokk], ['jsx', medJsx], ['linje', medLinje]] as const) {
    const ut = strip(kilde)
    assert.ok(!ut.includes('Se quiz') && !ut.includes("status !== 'kommende'"), `${navn}-kommentar ble ikke strippet`)
    assert.ok(ut.includes('const a = 1') && ut.includes('const b = 2'), `${navn}-stripping spiste kode`)
  }
  // Og motsatt: en ekte kodelinje med samme tekst skal OVERLEVE strippingen,
  // ellers ville fraværstestene aldri kunne bli røde.
  assert.ok(strip("const x = status !== 'kommende'").includes("status !== 'kommende'"))
})

// ── D: org-navn i nav-en er avkortet (6. september 2026) ────────────────────
//
// Org-navnet er det ENESTE brukerskrevne som kan havne i navigasjonsraden:
// topplinjens bedrifts-slot bærer navnet for hvert org-medlem (6. september
// 2026), og kontomenyen viser navn per rad når noen er medlem eller admin i
// MER ENN én bedrift. `validateOrgName` tillater 60 tegn, så to
// slike navn kunne dyttet raden langt forbi hamburgergrensen uansett hvor den
// står. Et brytepunkt er et tall; et navn er ubegrenset. Derfor avkorting.
//
// MØNSTERET ER LÅNT, IKKE OPPFUNNET: avatar-navnet i konto-knappen har hatt
// `maxWidth: 110` + ellipse + nowrap hele tiden. Testen under sammenligner
// verdiene MOT avatar-navnet, ikke mot et hardkodet tall, slik at de to ikke
// kan drifte fra hverandre uten at noen tar stilling til det.
//
// MUTASJONSBEVIS:
//   • Klemmen fjernes fra topplinjen → «topplinjen avkorter» ryker.
//   • Klemmen fjernes fra menyradene → «menyraden klemmer en INNER span» ryker.
//   • maxWidth heves → «samme verdi som avatar-navnet» ryker.
//   • Klemmen flyttes fra span-en til selve menyraden → «menyraden klemmer
//     en INNER span» ryker (en maks-bredde på raden krymper hele den
//     klikkbare flaten, ikke bare teksten).

test('D: klemmen er definert med de fire egenskapene ellipse krever', () => {
  const nav = aktivKode('components/NavAuth.tsx')
  assert.match(nav, /const orgNameClamp: React\.CSSProperties = \{/, 'orgNameClamp er borte')
  // Enkle delstreng-sjekker, ikke dynamisk RegExp: verdiene inneholder
  // apostrofer og klammer som måtte vært escapet, og en feil i den escapingen
  // ville gjort testen grønn på tom match i stedet for å felle noe.
  const paakrevd = [
    'maxWidth: ORG_NAME_MAX_WIDTH',
    "overflow: 'hidden'",
    "textOverflow: 'ellipsis'",
    "whiteSpace: 'nowrap'",
  ]
  const clampBlokk = nav.slice(nav.indexOf('const orgNameClamp'))
  const clampSlutt = clampBlokk.indexOf('}')
  const innmat = clampBlokk.slice(0, clampSlutt)
  for (const felt of paakrevd) {
    assert.ok(
      innmat.includes(felt),
      `orgNameClamp mangler «${felt}» — uten alle fire avkortes ikke teksten, den bare klippes eller flyter`
    )
  }
})

test('D: maks-bredden er SAMME verdi som avatar-navnets', () => {
  // Koblingen er poenget. Endres den ene uten den andre, har nav-en to ulike
  // svar på «hvor bred får brukerskrevet tekst være».
  const nav = aktivKode('components/NavAuth.tsx')
  const clampVerdi = nav.match(/const ORG_NAME_MAX_WIDTH = (\d+)/)
  assert.ok(clampVerdi, 'fant ikke ORG_NAME_MAX_WIDTH')
  const avatarVerdi = nav.match(/maxWidth: (\d+), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',/)
  assert.ok(avatarVerdi, 'fant ikke avatar-navnets klemme — er mønsteret den låner fra borte?')
  assert.equal(
    clampVerdi[1],
    avatarVerdi[1],
    'org-navnet og avatar-navnet har ulik maks-bredde. Velg én verdi, eller skriv ned hvorfor de skal avvike.'
  )
})

test('D: topplinjens org-lenke bruker klemmen når modellen ber om det', () => {
  // TopLink er den ene rendereren for topplinjen. Modellen setter
  // `clamp: true` på org-navnet (lib/nav-model.test.ts); her voktes at
  // rendereren faktisk oversetter flagget til orgNameClamp.
  const nav = aktivKode('components/NavAuth.tsx')
  assert.match(
    nav,
    /link\.clamp \? \{ \.\.\.navLink, \.\.\.orgNameClamp \} : navLink/,
    'TopLink avkorter ikke lenger klemte lenker — et 60-tegns org-navn sprenger raden igjen'
  )
})

test('D: menyraden klemmer en INNER span, ikke selve raden', () => {
  // `menuItem` er `width: 100%` med padding. En maks-bredde DER krymper hele
  // den klikkbare raden til 110 px og gjør den smalere enn søsknene. Avatar
  // gjør det riktig: knappen er full bredde, spannet inni er klemt.
  const nav = aktivKode('components/NavAuth.tsx')
  assert.match(
    nav,
    /link\.clamp \? <span style=\{\{ \.\.\.orgNameClamp, display: 'block' \}\}>\{link\.label\}<\/span> : link\.label/,
    'MenuRow klemmer ikke org-navn med en inner span'
  )
  assert.ok(
    !/style=\{\{ \.\.\.menuItem, \.\.\.orgNameClamp \}\}/.test(nav),
    'klemmen er flyttet til menyraden selv — da krymper hele den klikkbare flaten, ikke bare teksten'
  )
})

test('D: hvert sted modellen rendrer et org-navn er merket clamp, og NavAuth har ingen egne', () => {
  // Org-navnet er brukerskrevet. Modellen (lib/nav-model.ts) er det ENESTE
  // stedet det havner i en etikett, og hver slik forekomst må bære
  // `clamp: true` — ellers rendres den uten maks-bredde og sprenger raden
  // uansett hvor hamburgergrensen står.
  const modell = aktivKode('lib/nav-model.ts')
  const linjer = modell.split('\n').filter(l => l.includes('label: org.orgName'))
  assert.equal(linjer.length, 3, `org-navnet brukes som etikett ${linjer.length} steder i modellen, ventet 3 (topplinje, Bedriften ×flere, Bedriftspanel ×flere)`)
  for (const l of linjer) {
    assert.ok(l.includes('clamp: true'), `org-navn uten clamp i lib/nav-model.ts: ${l.trim()}`)
  }
  // Og NavAuth rendrer aldri org.orgName selv — da ville klemmen kunne glemmes der.
  const nav = aktivKode('components/NavAuth.tsx')
  assert.equal((nav.match(/org\.orgName/g) ?? []).length, 0, 'NavAuth rendrer org.orgName direkte, utenom modellen')
  const clampBruk = nav.match(/orgNameClamp/g) ?? []
  assert.equal(clampBruk.length, 3, `orgNameClamp brukes ${clampBruk.length} steder, ventet 3 (definisjonen + TopLink + MenuRow)`)
})
