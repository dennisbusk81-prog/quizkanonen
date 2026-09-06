// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: ett ord per ting i navigasjon og overskrifter.
//
// ── VEDTATT ORDBRUK (Dennis, 6. september 2026) ─────────────────────────────
//   Toppliste             den nasjonale lista — INGEN kvalifisering, den er
//                         standardtilfellet
//   Bedriftens toppliste  org-lista
//   Ligaens toppliste     én liga
//   Mine ligaer           oversikten over flere (nav-lenken heter «Ligaer»,
//                         ubestemt som resten av topplinjen — bevisst)
//   Resultater            ÉN quiz sin liste. En avsluttet quiz er ikke en
//                         pågående rangering, så den heter ikke «toppliste»
//   Quizarkiv             ett ord, konsekvent
//   Gratis                motsatsen til Premium (ikke «Standardkonto»)
//
// H1 står i bestemt form («Topplisten», «Quizarkivet»), nav i ubestemt —
// samme mønster som «Mine ligaer»-siden alt hadde.
//
// ── HVILKEN FEIL DENNE FILEN FINNES FOR ─────────────────────────────────────
// En kartlegging 5. september fant samme liste under seks navn
// («Sesongtoppliste», «Nasjonal toppliste», «den åpne topplisten», «Global
// konkurranse», …) og én quiz sine resultater under fire («Se leaderboard»,
// «Se topplisten», «Se full toppliste», «Se ukens resultater»). Ingen test
// voktet ordene, så hver ny flate valgte sitt eget. Denne fila gjør en ny
// drift rød: både at de vedtatte etikettene STÅR der de skal, og at de
// utgåtte ordene ikke kommer tilbake som navigasjonsetiketter.
//
// ── HVA SOM BEVISST IKKE VOKTES ─────────────────────────────────────────────
//   • app/vilkar/page.tsx og app/personvern/page.tsx sier fortsatt
//     «leaderboard». Juridiske sider endres ikke i en navnerunde — egen
//     beslutning, tatt separat. De er derfor unntatt fra fraværstesten.
//   • «Din arbeidsplass» (OrgCard) og «Din bedrift» (profil) er
//     kortoverskrifter for kort som inneholder MER enn topplisten. De
//     beskriver et sted, ikke en liste, og står med vilje.
//   • «Toppliste» som SectionLabel inne i bedriftspanelet: konteksten bærer
//     den, «Bedriftens toppliste» inne på bedriftens egen side er stotring.
//   • «Treningsrunder» / «Arkivkopier» i admin er admins navn på KOPIENE
//     (quiz_type='archive'), ikke brukerens inngang. Ikke Quizarkiv.
//   • lib/email-templates.ts sier fortsatt «sesongtoppliste» — e-postmaler
//     var utenfor bestillingen. Egen sak.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/kontomeny-arkivlenke.test.ts — npm test kjører kun lib/**/*.test.ts under
// Node sin egen runner, uten jsdom, og flatene er klientkomponenter på
// 400–5000 linjer.
//
// ── KOMMENTARER MÅ STRIPPES, ELLERS ER TESTEN RØD AV FEIL GRUNN ─────────────
// Kildekommentarer forklarer historikken og siterer de gamle ordene ordrett
// («Sesongtoppliste — konkurrér over tid» var usant …). `renKode()` fjerner
// blokk- og linjekommentarer FØR noe måles — og denne filas egne kommentarer
// er ikke med i målingen, siden den kun leser app/ og components/.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Topplinjens «Toppliste» skrives tilbake til «Sesongtoppliste» →
//     «topplinjen heter Toppliste» OG fraværstesten ryker.
//   • Kontomenyens «Quizarkiv» blir «Arkivet» igjen → «kontomenyen heter
//     Quizarkiv» ryker, og lib/kontomeny-arkivlenke.test.ts med den.
//   • Forsidens knapp får ÉN fast etikett igjen → «forsidens knapp følger
//     målet» ryker (den knappen har to destinasjoner, se testen).
//   • En ny flate skriver «Se leaderboard →» → fraværstesten ryker og
//     navngir fil og linje.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Kilden uten BOM og uten kommentarer. */
function renKode(raw: string): string {
  const utenBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

function les(fil: string): string {
  return renKode(readFileSync(fil, 'utf8'))
}

/** Alle .tsx-filer under en mappe, rekursivt, med skråstrek som skille. */
function tsxFiler(rot: string): string[] {
  const ut: string[] = []
  for (const navn of readdirSync(rot)) {
    const sti = join(rot, navn)
    if (statSync(sti).isDirectory()) ut.push(...tsxFiler(sti))
    else if (navn.endsWith('.tsx')) ut.push(sti.replace(/\\/g, '/'))
  }
  return ut
}

// ── De vedtatte etikettene STÅR der de skal ─────────────────────────────────

test('topplinjen og hamburgeren heter «Toppliste» — uten kvalifisering', () => {
  const nav = les('components/NavAuth.tsx')
  // Gjest og innlogget har hver sin topplinje-lenke og hver sin hamburger-rad.
  const topplinje = nav.match(/href="\/toppliste"[^>]*>Toppliste<\/a>/g) ?? []
  assert.equal(topplinje.length, 2, 'to topplinje-lenker (gjest + innlogget) skal hete Toppliste')
  // Hamburger-radene har flerlinje-attributter (onMouseEnter-pilfunksjoner med
  // «=>»), så `[^>]*` når ikke fram — ikke-grådig `[\s\S]*?` stopper ved
  // første lenketekst etter href-en.
  const alle = nav.match(/href="\/toppliste"[\s\S]*?>\s*Toppliste\s*<\/a>/g) ?? []
  assert.equal(alle.length, 4, 'topplinje + hamburger, gjest + innlogget = fire lenker til /toppliste med teksten Toppliste')
})

test('org-lenken i nav heter «Bedriftens toppliste»', () => {
  const nav = les('components/NavAuth.tsx')
  const treff = nav.match(/>\s*Bedriftens toppliste\s*<\/a>/g) ?? []
  assert.equal(treff.length, 2, 'topplinje + hamburger skal begge si Bedriftens toppliste')
})

test('kontomenyen heter «Quizarkiv», ikke «Arkivet»', () => {
  const nav = les('components/NavAuth.tsx')
  assert.match(nav, /href="\/arkiv"[\s\S]*?>\s*Quizarkiv\s*<\/a>/)
})

test('kontomerket for ikke-Premium heter «Gratis» — i nav og på profilen', () => {
  assert.match(les('components/NavAuth.tsx'), />\s*Gratis\s*<\/span>/)
  assert.match(les('app/profil/page.tsx'), />Gratis<\/span>/)
})

test('H1-ene står i bestemt form: Topplisten, Bedriftens toppliste, Quizarkivet, Mine ligaer', () => {
  assert.match(les('app/toppliste/page.tsx'), /Topp<em[^>]*>listen<\/em>/)
  assert.match(les('app/org/[slug]/page.tsx'), /Bedriftens <em[^>]*>toppliste<\/em>/)
  assert.match(les('app/arkiv/page.tsx'), /<h1[^>]*>Quizarkivet<\/h1>/)
  assert.match(les('app/liga/page.tsx'), /Mine <em[^>]*>ligaer<\/em>/)
})

test('én quiz sin liste heter Resultater der lenken peker på /leaderboard/<quizId>', () => {
  // Historikk-sidene lenker fra ett forsøk til den quizens resultatside.
  assert.match(les('app/historikk/page.tsx'), /\/leaderboard\/\$\{sisteForsok\.quiz_id\}[^>]*>\s*Resultater →/)
  assert.match(les('app/historikk/[attemptId]/page.tsx'), /\/leaderboard\/\$\{detail\.quiz_id\}[^>]*>\s*Resultater →/)
  // «Siste quiz»-raden i sesongtopplisten lenker til én quiz.
  assert.match(les('components/SeasonLeaderboard.tsx'), /Resultater →/)
})

test('resultatsidens bunnlenker: Toppliste / Bedriftens toppliste / Ligaens toppliste', () => {
  const side = les('app/leaderboard/[id]/page.tsx')
  assert.match(side, /Se bedriftens toppliste →/)
  assert.match(side, /Ligaens toppliste →/)
  assert.match(side, /href=\{`\/toppliste\$\{[^`]*`\}[^>]*>\s*Se topplisten →/)
  assert.match(side, /href="\/toppliste"[^>]*>\s*Toppliste →/)
})

test('forsidens knapp følger målet — Bedriftens toppliste eller Se resultatene', () => {
  // STRUKTURELL SAK FORKLEDD SOM NAVNEPROBLEM: samme knapp har to destinasjoner
  // (/org/<slug> for medlem av nøyaktig én bedrift, ellers forrige quiz sine
  // resultater). Etiketten følger målet som midlertidig svar; å gi knappen ÉN
  // destinasjon er en egen sak. Til den er tatt, skal ikke etiketten gå tilbake
  // til én fast tekst — da lyver den for én av de to gruppene.
  const forside = les('app/page.tsx')
  const treff = forside.match(/\{singleOrgToplistHref \? 'Bedriftens toppliste' : 'Se resultatene'\}/g) ?? []
  assert.equal(treff.length, 2, 'kommende-quiz-kortet og ingen-quiz-kortet deler knappen')
})

// ── De utgåtte ordene finnes ikke lenger som etiketter ──────────────────────

/** Ord som var i bruk fram til 6. september 2026 og som ikke skal komme tilbake. */
const UTGAATT: ReadonlyArray<{ re: RegExp; ble: string }> = [
  { re: /sesong-?toppliste/i, ble: 'Toppliste' },
  { re: /Nasjonal toppliste/, ble: 'Toppliste' },
  { re: /den åpne topplisten/, ble: 'topplisten' },
  { re: /Global konkurranse/, ble: 'topplisten' },
  { re: /\bMin bedrift\b/, ble: 'Bedriftens toppliste' },
  { re: /bedriftstoppliste/i, ble: 'Bedriftens toppliste' },
  { re: /bedrifts-toppliste/i, ble: 'bedriftens toppliste' },
  { re: /liga-toppliste/i, ble: 'Ligaens toppliste' },
  { re: /Se leaderboard/, ble: 'Resultater' },
  { re: /Se ukens resultater/, ble: 'Se resultatene' },
  { re: /Se full toppliste/, ble: 'Se resultatene / Se bedriftens toppliste' },
  { re: /Se toppliste →/, ble: 'Resultater →' },
  { re: /full toppliste/, ble: 'alle resultatene' },
  { re: /på leaderboard\b/, ble: 'på topplisten / i resultatene' },
  { re: /leaderboard for \$?\{/, ble: 'resultatene for' },
  { re: /Standardkonto/, ble: 'Gratis' },
  { re: />\s*Arkivet\s*</, ble: 'Quizarkiv' },
  { re: />\s*Arkiv\s*</, ble: 'Quizarkiv' },
  { re: /Til arkivet/, ble: 'Til quizarkivet' },
  { re: /fra arkivet/, ble: 'fra quizarkivet' },
  { re: /til arkivet</, ble: 'til quizarkivet' },
  { re: /'Arkivet — /, ble: "'Quizarkivet — " },
]

/** Juridiske sider — «leaderboard» står der etter egen beslutning. */
const UNNTATT = new Set(['app/vilkar/page.tsx', 'app/personvern/page.tsx'])

/**
 * Admin-badgen «Arkiv» på arkivkopi-rader er en STATUS, ikke navigasjon, og
 * gruppetittelen «Arkivkopier» er admins ord for kopiene. Begge står med vilje.
 */
const ADMIN_STATUS_UNNTAK = new Set(['app/admin/page.tsx', 'app/admin/quizzes/page.tsx'])

test('ingen utgått etikett står igjen i app/ eller components/', () => {
  const filer = [...tsxFiler('app'), ...tsxFiler('components')].filter(f => !UNNTATT.has(f))
  const funn: string[] = []
  for (const fil of filer) {
    const linjer = les(fil).split('\n')
    linjer.forEach((linje, i) => {
      for (const { re, ble } of UTGAATT) {
        if (re.source === />\s*Arkiv\s*</.source && ADMIN_STATUS_UNNTAK.has(fil)) continue
        if (re.test(linje)) funn.push(`${fil}:${i + 1}  /${re.source}/  → skal være «${ble}»:  ${linje.trim()}`)
      }
    })
  }
  assert.deepEqual(funn, [], `utgåtte etiketter funnet:\n${funn.join('\n')}`)
})

test('de juridiske sidene står FORTSATT med «leaderboard» — flyttes de, skal unntaket bort', () => {
  // Unntaket over er en beslutning, ikke en glipp. Blir sidene skrevet om
  // separat, skal denne testen minne om å fjerne unntaket, så vakten dekker
  // dem også.
  for (const fil of UNNTATT) {
    assert.match(les(fil), /leaderboard/, `${fil} sier ikke lenger «leaderboard» — fjern fila fra UNNTATT`)
  }
})
