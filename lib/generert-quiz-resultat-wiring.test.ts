// Kjøres med:  npm test
//
// STRUKTURTEST: en GENERERT quiz (kanonkule) på resultat-/allerede-spilt-
// skjermen i app/quiz/[id]/page.tsx peker til FORSIDEN, ikke til quizarkivet
// (8. september 2026, kveld — Dennis, andre runde).
//
// Fram til nå behandlet skjermen alle `quiz_type='archive'` likt: «Denne
// treningsrunden er ferdigspilt — start en ny fra quizarkivet.» og en
// gullknapp «Til quizarkivet». For en kanonkule er begge usanne: en
// gratisbruker med to kuler har aldri hatt tilgang til arkivet (Premium), og
// en ny kanonkule lages fra forsiden. Skillet er `source_quiz_id === null`
// — normalen for genererte quizer (lib/archive-copy.ts) — og det står som
// `isGenerated` rett under `isArchive`.
//
// MUTASJONSBEVIS (8. september 2026):
//   • `const isGenerated = false`                     → tre tester røde
//   • generert-teksten → arkiv-teksten                 → tekst-testen rød
//   • én av de to «Til forsiden»-knappene → href="/arkiv" → knapp-testen rød
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const RAW = readFileSync(path.join(process.cwd(), 'app/quiz/[id]/page.tsx'), 'utf8')
const SRC = RAW.charCodeAt(0) === 0xfeff ? RAW.slice(1) : RAW

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

const AKTIV = aktiveLinjer(SRC)

test('isGenerated er «arkivkopi UTEN forelder» — avledet av isArchive og source_quiz_id', () => {
  assert.match(AKTIV, /const isGenerated = isArchive && quiz\?\.source_quiz_id === null/)
})

test('Quiz-typen bærer source_quiz_id (ellers er sammenligningen alltid false uten at tsc sier fra)', () => {
  const sup = readFileSync(path.join(process.cwd(), 'lib/supabase.ts'), 'utf8')
  assert.match(aktiveLinjer(sup), /source_quiz_id: string \| null/)
})

test('allerede-spilt-teksten: generert → «lag en ny fra forsiden», reprise → «fra quizarkivet»', () => {
  const m = /\{isGenerated\s*\?\s*'Denne quizen er ferdigspilt — lag en ny fra forsiden\.'\s*:\s*isArchive\s*\?\s*'Denne treningsrunden er ferdigspilt — start en ny fra quizarkivet\.'\s*:\s*'Én gjennomspilling per quiz\.'\}/.exec(AKTIV)
  assert.ok(m, 'tekst-kjeden isGenerated → isArchive → vanlig finnes ikke i den formen')
})

test('BEGGE primærknappene: generert → «Til forsiden» (href="/"), reprise → «Til quizarkivet»', () => {
  // Allerede-spilt-skjermen og resultatskjermen har hver sin knapp. Begge
  // må skille — en gratiseier som havner på /arkiv møter en låst side.
  const forsiden = AKTIV.match(/\{isGenerated \? \(\s*(?:<div[^>]*>\s*)?<a href="\/" className="qk-btn-primary"[^>]*>Til forsiden<\/a>/g) ?? []
  assert.equal(forsiden.length, 2, `fant ${forsiden.length} «Til forsiden»-knapper bak isGenerated, forventet 2`)
  const arkiv = AKTIV.match(/\) : isArchive \? \(\s*(?:<div[^>]*>\s*)?<a href="\/arkiv" className="qk-btn-primary"[^>]*>Til quizarkivet<\/a>/g) ?? []
  assert.equal(arkiv.length, 2, `fant ${arkiv.length} «Til quizarkivet»-knapper bak isArchive-grenen, forventet 2`)
  // Ingen arkivknapp uten at isGenerated er sjekket først.
  const ugatet = AKTIV.match(/\{isArchive \? \(\s*(?:<div[^>]*>\s*)?<a href="\/arkiv"/g) ?? []
  assert.equal(ugatet.length, 0, 'en «Til quizarkivet»-knapp står bak isArchive alene — den treffer også genererte quizer')
})
