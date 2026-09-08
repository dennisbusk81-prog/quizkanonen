// Kjøres med:  npm test
//
// STRUKTURTEST for kanonkule-kortet (8. september 2026, kveld) — kobling
// mellom app/page.tsx og components/KanonkulerCard.tsx. Komponenten kan ikke
// rendres under node --test (loaderen stripper typer, ikke JSX), så beviset
// er tekstlig, med AKTIVE linjer som anker: en utkommentert vakt skal ikke
// telle (samme hjelper som lib/league-affordance-wiring.test.ts).
//
// Hva som voktes, og hvorfor:
//   • kortet rendres bak `!premiumUnknown`, IKKE `!isPremium` og ikke
//     ugatet — begge tekstsettene påstår noe om kontoen
//   • planen kommer fra decidePremiumFromProfile (rutens funksjon), og
//     profil-spørringen henter karenskolonnene den trenger
//   • tellingen bruker osloMonthStartUtcIso — den NORSKE måneden, som ruten;
//     ikke forsidens UTC-baserte `monthStart`
//   • kortet har ingen gull: forsiden har alt gull til quizkortets CTA
//   • velgeren rendres kun for premium; gratis får bekreftelsessteget
//   • suksess navigerer rett inn i quizen — ingen mellomskjerm
//
// MUTASJONSBEVIS (8. september 2026):
//   • `!premiumUnknown &&` → `!isPremium &&` rundt kortet   → gate-testen rød
//   • fjern `org_premium_grace_until` fra profil-select     → kolonne-testen rød
//   • `osloMonthStartUtcIso(now.getTime())` → `monthStart`  → månedsgrense-testen rød
//   • `plan === 'premium' && (` → `true && (` rundt velgeren → velger-testen rød
//   • `if (plan === 'free') { setPhase('confirm')` fjernet  → bekreftelses-testen rød
//   • `border: '1px solid #e8e4dd'` → `#c9a84c` på knappen  → gull-testen rød
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

function les(rel: string): string {
  const raw = readFileSync(path.join(process.cwd(), rel), 'utf8')
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

/** Kun linjer som faktisk kjører — en utkommentert vakt skal ikke telle. */
function aktiveLinjer(kropp: string): string {
  return kropp
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('{/*')
    })
    .join('\n')
}

const PAGE = aktiveLinjer(les('app/page.tsx'))
const CARD = aktiveLinjer(les('components/KanonkulerCard.tsx'))

// ── app/page.tsx ────────────────────────────────────────────────────────────

test('forsiden importerer kortet og de tre hjelperne den regner med', () => {
  assert.match(PAGE, /import KanonkulerCard from '@\/components\/KanonkulerCard'/)
  assert.match(PAGE, /import \{ osloMonthStartUtcIso, osloNextMonthStartLabel \} from '@\/lib\/oslo-time'/)
  assert.match(PAGE, /import \{ decidePremiumFromProfile \} from '@\/lib\/premium-check'/)
  assert.match(PAGE, /import \{ planFromPremium \} from '@\/lib\/generated-quiz-rules'/)
})

test('kortet rendres bak !premiumUnknown — ikke !isPremium, ikke ugatet', () => {
  const m = /\{!premiumUnknown && \(\s*<ErrorBoundary>\s*<KanonkulerCard/.exec(PAGE)
  assert.ok(m, 'fant ikke `{!premiumUnknown && (<ErrorBoundary><KanonkulerCard`')
  assert.doesNotMatch(PAGE, /\{!isPremium && \(\s*<ErrorBoundary>\s*<KanonkulerCard/)
  assert.doesNotMatch(PAGE, /\{isPremium && \(\s*<ErrorBoundary>\s*<KanonkulerCard/)
  assert.equal((PAGE.match(/<KanonkulerCard/g) ?? []).length, 1, 'kortet skal rendres nøyaktig ett sted')
})

test('planen til kortet er rutens: planFromPremium(decidePremiumFromProfile(profile, now))', () => {
  assert.match(PAGE, /const generationPlan = planFromPremium\(decidePremiumFromProfile\(profile, now\)\)/)
  assert.match(PAGE, /plan=\{generationPlan\}/)
})

test('profil-spørringen henter karenskolonnene decidePremiumFromProfile leser', () => {
  assert.match(
    PAGE,
    /\.select\('display_name, premium_status, has_used_trial, org_premium_grace_until, personal_grace_until'\)/,
    'uten karenskolonnene regner kortet en bruker i karens som gratis mens ruten gir henne 30',
  )
})

test('tellingen mot ledgeren bruker den NORSKE månedsgrensen, ikke forsidens UTC-monthStart', () => {
  const i = PAGE.indexOf(".from('quiz_generations')")
  assert.ok(i > 0, 'ingen telling mot quiz_generations på forsiden')
  const utsnitt = PAGE.slice(i, i + 400)
  assert.match(utsnitt, /\.select\('id', \{ count: 'exact', head: true \}\)/)
  assert.match(utsnitt, /\.eq\('user_id', user\.id\)/)
  assert.match(utsnitt, /\.gte\('created_at', osloMonthStartUtcIso\(now\.getTime\(\)\)\)/)
  assert.doesNotMatch(utsnitt, /\.gte\('created_at', monthStart\)/)
})

test('kuler igjen er null når tellingen feilet — «vet ikke», aldri 0', () => {
  assert.match(PAGE, /const kanonkulerIgjen = generationsUnknown\s*\?\s*null\s*:\s*kanonkulerRemaining\(generationPlan, generationsResult\.count \?\? 0\)/)
  assert.match(PAGE, /remaining=\{kanonkulerIgjen\}/)
})

test('etiketten er første dag i NESTE norske måned', () => {
  assert.match(PAGE, /nextMonthLabel=\{osloNextMonthStartLabel\(now\.getTime\(\)\)\}/)
})

test('plassering: under quizkortets «Se alle quizer», over «Ukens fakta»', () => {
  const seAlle = PAGE.indexOf('Se alle quizer →')
  const kort = PAGE.indexOf('<KanonkulerCard')
  const fakta = PAGE.indexOf('Ukens fakta')
  assert.ok(seAlle > 0 && kort > 0 && fakta > 0)
  assert.ok(seAlle < kort, 'kortet ligger over «Se alle quizer» — det skal under fredagsquizen, ikke inni den')
  assert.ok(kort < fakta, 'kortet ligger under «Ukens fakta»')
})

// ── components/KanonkulerCard.tsx ───────────────────────────────────────────

test('kortet har ingen gull — forsiden bruker alt gull til quizkortets CTA', () => {
  assert.doesNotMatch(CARD, /c9a84c/i)
  assert.doesNotMatch(CARD, /201,\s*168,\s*76/)
})

test('ingen emoji i kortet', () => {
  assert.doesNotMatch(CARD, /\p{Extended_Pictographic}/u)
})

test('kategorivelgeren rendres KUN for premium, og henter lista fra generatorCategoryOptions', () => {
  const m = /\{plan === 'premium' && \(\s*<label[\s\S]*?<select[\s\S]*?generatorCategoryOptions\(\)\.map/.exec(CARD)
  assert.ok(m, 'velgeren er ikke gatet på `plan === \'premium\'` rett foran <label>/<select>')
  assert.equal((CARD.match(/<select/g) ?? []).length, 1, 'nøyaktig én velger')
  assert.match(CARD, /<option value=\{BLANDET\}>Blandet<\/option>/)
  assert.doesNotMatch(CARD, /QUIZ_CATEGORIES/, 'kortet skal lese den FILTRERTE lista, ikke QUIZ_CATEGORIES rått')
})

test('gratis går via bekreftelsessteget; premium rett gjennom', () => {
  assert.match(CARD, /if \(plan === 'free'\) \{\s*setPhase\('confirm'\)\s*return\s*\}\s*void lagQuiz\(\)/)
  assert.match(CARD, /\{KANONKULER_FREE_CONFIRM_TEXT\}/)
})

test('gratis sender aldri kategori — ruten ville svart 403', () => {
  assert.match(CARD, /body: JSON\.stringify\(plan === 'premium' && category !== BLANDET \? \{ category \} : \{\}\)/)
})

test('suksess (201 + quizId) navigerer rett inn i quizen — ingen mellomskjerm', () => {
  assert.match(CARD, /if \(res\.status === 201 && json\?\.quizId\) \{\s*router\.push\(`\/quiz\/\$\{json\.quizId\}`\)/)
})

test('serverens tekst vises som den er ved avslag (kvote-429, 503), med generisk fallback', () => {
  assert.match(CARD, /setError\(json\?\.error \?\? 'Noe gikk galt\. Prøv igjen\.'\)/)
})

test('tom-tilstanden viser oppsalget som lenke til /premium — og bare når status.upsell finnes', () => {
  assert.match(CARD, /\{status\.upsell && \(\s*<>\s*\{' · '\}\s*<Link href="\/premium"/)
})

test('kortets faste tekster kommer fra lib/kanonkuler-tekst — ikke hardkodet i JSX-en', () => {
  assert.match(CARD, /<p style=\{s\.eyebrow\}>\{KANONKULER_EYEBROW\}<\/p>/)
  assert.match(CARD, /<h2 id="kanonkuler-tittel" style=\{s\.title\}>\{KANONKULER_TITLE\}<\/h2>/)
  assert.match(CARD, /<p style=\{s\.body\}>\{KANONKULER_BODY_TEXT\}<\/p>/)
  assert.doesNotMatch(CARD, /Tilfeldig quiz|Kanonkuler<\/p>|Én kanonkule gir deg/)
})

test('oppsalgslinja: KUN gratis med kuler igjen, rett under statuslinja, tekstlenke til /premium — ikke knapp', () => {
  const m = /\{status && <p style=\{s\.status\}>\{status\.text\}<\/p>\}\s*\{plan === 'free' && status\?\.kind === 'igjen' && \(\s*<p style=\{s\.upsellLine\}>\s*<Link href="\/premium" style=\{s\.upsellLineLink\}>\{KANONKULER_FREE_UPSELL_LINE\}<\/Link>/.exec(CARD)
  assert.ok(m, 'oppsalgslinja står ikke rett under statuslinja, gatet på gratis + igjen, som <Link>')
  assert.equal((CARD.match(/KANONKULER_FREE_UPSELL_LINE\}/g) ?? []).length, 1, 'linja rendres nøyaktig ett sted')
  assert.doesNotMatch(CARD, /<button[^>]*>\{KANONKULER_FREE_UPSELL_LINE/)
})

test('kortet følger designsystemet: kort-radius 16, knapp-radius 10, knapp 10px 28px auto-bredde', () => {
  assert.match(CARD, /card: \{[\s\S]*?background: '#21242e'[\s\S]*?border: '1px solid #2a2d38'[\s\S]*?borderRadius: 16/)
  assert.match(CARD, /btn: \{[\s\S]*?border: '1px solid #e8e4dd'[\s\S]*?padding: '10px 28px'[\s\S]*?borderRadius: 10[\s\S]*?width: 'auto'/)
  assert.match(CARD, /var\(--font-libre-baskerville\)/)
  assert.match(CARD, /var\(--font-instrument-sans\)/)
})
