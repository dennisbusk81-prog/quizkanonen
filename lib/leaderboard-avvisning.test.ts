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
import { klassifiserAvvisning, velgTomSkjerm, ikkeMedlemTekst, avvistMidtIOkta } from './leaderboard-avvisning'

// ── Statuskode → årsak ──────────────────────────────────────────────────────

test('401 er «uinnlogget» — og ingenting annet er det', () => {
  assert.equal(klassifiserAvvisning(401), 'uinnlogget')
  for (const status of [400, 403, 404, 429, 500, 503]) {
    assert.notEqual(klassifiserAvvisning(status), 'uinnlogget', `${status} skal ikke lese som uinnlogget`)
  }
})

test('403 med code org_locked er «laast» — statusen alene skiller ikke', () => {
  // Uten koden ville et medlem av en låst bedrift fått «Du er ikke medlem av
  // denne bedriften» — usant. Samme feilklasse som sesjonsgjetningen, ett lag
  // dypere.
  assert.equal(klassifiserAvvisning(403, 'org_locked'), 'laast')
  assert.equal(klassifiserAvvisning(403, null), 'ikke-medlem')
  assert.equal(klassifiserAvvisning(403, undefined), 'ikke-medlem')
  assert.equal(klassifiserAvvisning(403, 'noe_annet'), 'ikke-medlem')
  // Koden alene er ikke nok heller: 'laast' krever 403.
  for (const status of [200, 400, 401, 500]) assert.notEqual(klassifiserAvvisning(status, 'org_locked'), 'laast')
  assert.equal(velgTomSkjerm('laast'), 'laast')
  assert.match(avvistMidtIOkta('laast'), /Bedriften venter på fornyelse/)
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

test('de fire skjermene er innbyrdes FORSKJELLIGE', () => {
  // Selve poenget med saken. Kollapser to av dem til samme verdi, er vi
  // tilbake til «tre tilstander, ett svar».
  const skjermer = [velgTomSkjerm('uinnlogget'), velgTomSkjerm('ikke-medlem'), velgTomSkjerm('laast'), velgTomSkjerm('feil')]
  assert.equal(new Set(skjermer).size, 4, `to eller flere årsaker deler skjerm: ${skjermer.join(', ')}`)
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
  assert.match(src, /setAvvisning\(klassifiserAvvisning\(res\.status, kode\)\)/,
    'statuskoden kastes — da er årsaken tapt før noen kan vise den')
  // Koden i kroppen leses FØR klassifiseringen — statusen alene skiller ikke
  // «ikke medlem» fra «låst bedrift».
  assert.match(src, /const kode = await lesAvvisningskode\(res\)/, 'koden i kroppen leses ikke')
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

test('alle fem skjermene rendres, hver med sin egen tekst', () => {
  const src = aktivKode(KOMP)
  for (const [gren, tekst] of [
    ["skjerm === 'feil'", 'Noe gikk galt. Prøv å laste siden på nytt.'],
    ["skjerm === 'laast'", 'LAAST_OVERSKRIFT'],
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
  // Låst-skjermen tilbyr heller ingen handling: et medlem kan ikke fornye.
  const lStart = src.indexOf("skjerm === 'laast'")
  const lSlutt = src.indexOf("skjerm === 'ikke-medlem'")
  const lGren = src.slice(lStart, lSlutt)
  assert.ok(lGren.includes('LAAST_OVERSKRIFT') && lGren.includes('LAAST_TEKST'), 'låst-skjermen bruker ikke den delte ordlyden')
  assert.ok(!lGren.includes('<Link') && !lGren.includes('<button'), 'låst-skjermen tilbyr en handling — en knapp som garantert feiler er verre enn ingen')
})

// ── ALLE TRE HENTESTEDENE DELER KLASSIFISERING (6. september 2026) ──────────
//
// `loadHistory` og `fetchExpanded` kollapset statusen på samme måte som
// hovedhentingen gjorde, og viste «Prøv igjen». De er kun nåbare ETTER at
// hovedkallet gikk gjennom med tilgang — men latent er ikke lukket, og
// tilfellet er ikke hypotetisk: Elkjøp har ~29 ansatte, og
// `scheduled-removals`/`cleanup-orgs` kjører som cron. Blir du fjernet med
// siden åpen, er det disse grenene du treffer.
//
// MUTASJONSBEVIS: la ETT av de tre stedene beholde den gamle kollapsen
// (`throw new Error()`, `setHistError(true)`, `.set(key, 'error')`) → tellingen
// under blir rød.

test('alle tre hentestedene klassifiserer statusen', () => {
  const src = aktivKode(KOMP)
  const treff = src.match(/klassifiserAvvisning\(res\.status, (?:kode|await lesAvvisningskode\(res\))\)/g) ?? []
  assert.equal(
    treff.length,
    3,
    `klassifiserAvvisning(res.status, <kode>) brukes ${treff.length} steder, ventet 3 ` +
      '(hovedhenting, loadHistory, fetchExpanded). Ett av dem kollapser statusen igjen.'
  )
})

test('ingen av de tre stedene har den gamle kollapsen igjen', () => {
  const src = aktivKode(KOMP)
  for (const gammel of ['throw new Error()', 'setHistError(', ".set(key, 'error')"]) {
    assert.ok(!src.includes(gammel), `den gamle kollapsen «${gammel}» er tilbake`)
  }
})

test('de to sekundære stedene deler ÉN ordlyd for midt-i-økta', () => {
  // To nesten like formuleringer ville drevet fra hverandre ved første
  // redigering. Begge kallstedene bruker samme helper.
  const src = aktivKode(KOMP)
  const treff = src.match(/avvistMidtIOkta\(/g) ?? []
  assert.equal(treff.length, 2, `avvistMidtIOkta brukes ${treff.length} steder, ventet 2`)
})

test('midt-i-økta-tekstene sier at tilstanden ENDRET seg', () => {
  assert.equal(avvistMidtIOkta('ikke-medlem'), 'Du har ikke lenger tilgang til denne listen.')
  assert.match(avvistMidtIOkta('uinnlogget'), /logget ut/)
  // «lenger» og «logget ut» er det som skiller dette fra førstegangs-avvisning.
  assert.match(avvistMidtIOkta('ikke-medlem'), /lenger/)
})

test('midt-i-økta-grenene tilbyr INGEN retry — den kan ikke lykkes', () => {
  const src = aktivKode(KOMP)
  // Begge grenene står rett foran sin «feil»-gren, som beholder retry.
  for (const anker of ["histAvvisning === 'uinnlogget'", "expanded === 'uinnlogget'"]) {
    const start = src.indexOf(anker)
    assert.notEqual(start, -1, `fant ikke grenen ${anker}`)
    const slutt = src.indexOf(') : ', start + anker.length)
    const gren = src.slice(start, slutt)
    assert.ok(!gren.includes('retryBtn'), `grenen ${anker} har en retry-knapp — et nytt forsøk gir samme svar`)
  }
})

// ── Skinnen — ÉN komponent for fire flater (7. september 2026) ──────────────
//
// Designinvariantene under ble vedtatt 6. september for bryteren på
// /toppliste (c1a3115). 7. september ble bryteren trukket ut til
// components/ScopeRail.tsx og delt av /toppliste, /org/[slug], /liga/[slug]
// og /leaderboard/[id]. Testene ankrer derfor på KOMPONENTEN, ikke på siden —
// samme invarianter, ett sted. Hvilke valg som vises, og at alle fire flatene
// bruker komponenten, voktes i lib/scope-rail.test.ts.

const SKINNE = 'components/ScopeRail.tsx'

test('scope-skinnen bruker ALDRI gull', () => {
  // Den aktive periodefanen rett under er gull. To gullelementer på samme
  // skjerm bryter husregelen, og skinnen skal uansett markeres med kontrast,
  // ikke farge — den avgrenser HVEM, periodefanene NÅR.
  const src = aktivKode(SKINNE)
  assert.ok(!src.includes('#c9a84c') && !src.includes('201,168,76'), 'scope-skinnen bruker gull — to gullelementer på samme skjerm')
})

test('skinnen har en ramme rundt ALLE valgene', () => {
  // Rammen er det som gjør den til en kontroll uten hover. Uten den leste
  // org-navnet som brødtekst.
  const src = aktivKode(SKINNE)
  assert.match(src, /const railStyle[\s\S]{0,400}border: '1px solid #2a2d38'/,
    'skinnen mangler rammen — da leser den ikke som trykkbar på mobil')
  assert.match(src, /const railStyle[\s\S]{0,400}display: 'inline-flex'/,
    'rammen spenner hele sidebredden i stedet for å stramme seg rundt valgene')
})

test('valgene er LENKER — trykkbare uten hover, og de navigerer', () => {
  // 7. september: segmentene ble lenker (skinnen navigerer mellom flater).
  // En lenke med href er trykkbar av natur; den gamle `cursor: pointer` på en
  // knapp er ikke lenger det som bærer signalet.
  const src = aktivKode(SKINNE)
  assert.match(src, /<a\s[\s\S]{0,200}href=\{o\.href\}/, 'segmentene er ikke lenker med href')
  assert.ok(!src.includes('<button'), 'skinnen har knapper — den skal navigere, ikke bytte på stedet')
  assert.match(src, /textDecoration: 'none'/, 'lenkene er understreket — de skal se ut som segmenter')
})

test('inaktiv bruker den GODKJENTE dempede fargen, ikke den forbudte', () => {
  // #7a7873 står som FORBUDT i CLAUDE.md: 3,86:1 mot bakgrunnen, under
  // AA-kravet på 4,5:1. #918f8a er erstatteren som ble innført 1. august 2026.
  const src = aktivKode(SKINNE)
  assert.ok(!src.includes('#7a7873'), 'den forbudte lavkontrastfargen #7a7873 er i bruk')
  assert.match(src, /const segmentStyle[\s\S]{0,700}color: aktiv \? '#ffffff' : '#918f8a'/,
    'inaktiv-fargen er endret — sjekk kontrasten mot #1a1c23 før du bytter')
})

test('aktivt valg skiller seg på BÅDE fylling og tekstfarge', () => {
  // Fargen alene er ikke nok: en mutasjon som ga begge valgene samme
  // BAKGRUNN overlevde tester som bare så på `color`. Fyllingen er det
  // sterkeste signalet om hvilket segment som er valgt, særlig på mobil der
  // ingen hover finnes.
  const src = aktivKode(SKINNE)
  assert.match(src, /const segmentStyle[\s\S]{0,700}background: aktiv \? '#21242e' : 'transparent'/,
    'aktivt og inaktivt valg deler bakgrunn — da er det ikke synlig hvilket som er valgt')
})

test('org-navnet i skinnen avkortes med 110 px-klemmen', () => {
  const src = aktivKode(SKINNE)
  assert.match(src, /const segmentStyle[\s\S]{0,700}maxWidth: 110,[\s\S]{0,120}textOverflow: 'ellipsis'/,
    'klemmen er borte eller endret — en bedrift med langt navn sprenger skinnen')
})

test('skinnen scroller heller enn å brekke til to linjer', () => {
  // Tre valg med lange navn kan bli bredere enn en smal mobil. En segmentert
  // kontroll som wrapper slutter å lese som én kontroll.
  const src = aktivKode(SKINNE)
  assert.match(src, /const railStyle[\s\S]{0,400}overflowX: 'auto'/, 'skinnen mangler sidelengs scroll')
  assert.ok(!/const railStyle[\s\S]{0,400}flexWrap/.test(src), 'skinnen wrapper — da leser den ikke lenger som én kontroll')
})

test('valgene rendres fra modellen — ett segment per valg, ingen egen liste', () => {
  // Antallet følger lib/scope-rail.ts (Alle + ett per medlemskap + ligaen på
  // ligasiden). Komponenten mapper over det den får og legger ikke til noe.
  const src = aktivKode(SKINNE)
  assert.match(src, /\{options\.map\(o => \(/, 'segmentene rendres ikke fra options')
  assert.ok(!src.includes('myOrgs'), 'komponenten leser myOrgs selv — valgene skal komme fra scopeRailOptions')
  assert.ok(!src.includes("'Alle'"), 'komponenten har en egen «Alle» — etiketten bor i lib/scope-rail.ts')
})

test('hover er DEKLARATIV CSS, ikke imperativ styling', () => {
  // Første forsøk brukte onMouseEnter/onMouseLeave til å skrive
  // `e.currentTarget.style.color`. På et element hvis `style` React også eier
  // endte attributtet som `color: currentcolor`, og da ARVET begge segmentene
  // farge: det aktive valget ble dempet og det inaktive hvitt. Målt i
  // nettleseren, ikke resonnert fram.
  const src = aktivKode(SKINNE)
  assert.ok(!src.includes('onMouseEnter'), 'imperativ hover er tilbake — den korrumperer style-attributtet')
  assert.ok(!src.includes('currentTarget.style'), 'imperativ stilskriving er tilbake')
  assert.match(src, /\.qk-scope-tab\[aria-current="false"\]:hover \{ color: #e8e4dd; \}/,
    'hover-regelen mangler — inaktivt valg løfter seg ikke ved hover')
  // Regelen henger på aria-current, så CSS og skjermleser leser SAMME kilde.
  assert.match(src, /aria-current=\{o\.active \? 'page' : 'false'\}/, 'segmentet mangler aria-current — hover-regelen ville da aldri treffe')
})

test('skinnen har en etikett som forklarer hva valgene gjelder', () => {
  // «Alle» og «Elkjøp Nordic» er to ord uten kontekst — «Alle» sier ikke alle
  // HVA. Periodefanene under trenger ingen etikett fordi ordene deres er
  // selvforklarende; skinnens ord er ikke det.
  const src = aktivKode(SKINNE)
  assert.match(src, /<span id="qk-scope-label" style=\{labelStyle\}>Blant:<\/span>/,
    'etiketten «Blant:» foran skinnen er borte')
  assert.match(src, /const labelStyle[\s\S]{0,300}color: '#918f8a'/, 'etiketten bruker ikke hintfargen')
  // Mindre enn segmentteksten (13), så etiketten underordner seg valgene.
  // LAT kvantor, ikke grådig — se historikken i forgjengeren av denne testen.
  const etikettStr = src.match(/const labelStyle[\s\S]{0,300}?fontSize: (\d+)/)
  const segmentStr = src.match(/const segmentStyle[\s\S]{0,700}?fontSize: (\d+)/)
  assert.ok(etikettStr && segmentStr, 'fant ikke skriftstørrelsene')
  assert.ok(Number(etikettStr[1]) < Number(segmentStr[1]),
    `etiketten (${etikettStr[1]}px) er ikke mindre enn segmentene (${segmentStr[1]}px)`)
})

test('etiketten ER gruppens tilgjengelige navn', () => {
  // aria-labelledby, ikke en usynlig aria-label ved siden av: ellers får
  // kontrollen to konkurrerende navn, og skjermleseren leser et annet ord enn
  // det som står på skjermen. Gruppen er en <nav> — skinnen navigerer.
  const src = aktivKode(SKINNE)
  assert.match(src, /<nav style=\{railStyle\} aria-labelledby="qk-scope-label">/,
    'gruppen peker ikke på den synlige etiketten')
  assert.ok(!/aria-label="Hvilken liste"/.test(src),
    'den gamle usynlige aria-label-en står igjen ved siden av den synlige etiketten')
})
