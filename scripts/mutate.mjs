// Mutasjonstesting: bytt ut en kodebit, kjør testene, rull tilbake.
//
//   node scripts/mutate.mjs <fil> "<fra>" "<til>"
//   npm test -- <testfil>
//   git checkout -- <fil>
//
// HVORFOR DENNE FINNES (12. august 2026)
// Et mutasjonsbevis er verdiløst hvis mutasjonen aldri ble skrevet. På én kveld
// ga tre forsøk falske grønne uten at noe var galt med koden:
//
//   1. `python -c "..."` — python finnes ikke på denne maskinen. Kommandoen
//      feilet, filen var urørt, og testene var grønne «på tross av» en mutasjon
//      som aldri eksisterte.
//   2. Ankeret var skrevet med LF, mens filen har CRLF. Ingen treff, ingen
//      endring, grønt.
//   3. Ankeret traff, men mutasjonen flyttet ikke det den skulle flytte — den
//      ble satt inn på samme sted som originalen.
//
// Derfor: skriptet avbryter høylytt hvis ankeret ikke treffer, hvis det treffer
// flere steder (da vet du ikke hvilket som ble endret), og hvis filen på DISK
// ikke faktisk inneholder endringen etterpå. Et grønt testsvar etter en
// «vellykket» mutasjon betyr da at testene virkelig ikke fanger den.
//
// Merk at (3) ikke kan fanges automatisk — at mutasjonen er GYLDIG, altså at
// den faktisk uttrykker feilen du vil teste for, må du fortsatt vurdere selv.
// Skriptet garanterer bare at noe ble skrevet.

import fs from 'node:fs'

const [, , file, fromRaw, toRaw] = process.argv

if (!file || fromRaw === undefined || toRaw === undefined) {
  console.error('Bruk: node scripts/mutate.mjs <fil> "<fra>" "<til>"')
  process.exit(2)
}

const before = fs.readFileSync(file, 'utf8')

// Linjeskift normaliseres til filens egen stil, så et anker skrevet i et
// terminalvindu med LF treffer en fil med CRLF.
const crlf = before.includes('\r\n')
const norm = (t) => (crlf ? t.replace(/\r?\n/g, '\r\n') : t.replace(/\r\n/g, '\n'))
const from = norm(fromRaw)
const to = norm(toRaw)

if (!before.includes(from)) {
  console.error('  ✗ MUTASJON TRAFF IKKE — ingenting skrevet')
  process.exit(9)
}

const treff = before.split(from).length - 1
if (treff > 1) {
  console.error(`  ✗ MUTASJON TVETYDIG (${treff} treff) — ingenting skrevet`)
  process.exit(9)
}

fs.writeFileSync(file, before.replace(from, to))

// Les tilbake fra disk. Det er dette steget som skiller «mutasjonen er skrevet»
// fra «kommandoen returnerte uten å klage».
const after = fs.readFileSync(file, 'utf8')
if (after === before) {
  console.error('  ✗ FILEN ER UENDRET etter skriving')
  process.exit(9)
}
if (!after.includes(to.slice(0, 40))) {
  console.error('  ✗ MUTASJONEN FINNES IKKE PÅ DISK')
  process.exit(9)
}

console.log('  ✓ mutasjon skrevet og verifisert på disk')
