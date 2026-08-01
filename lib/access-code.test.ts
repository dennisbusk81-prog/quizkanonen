// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateAccessCode,
  buildAccessCode,
  buildAccessCodePatch,
  PERSONAL_CODE_LENGTH,
  MAX_USES_CEILING,
} from './access-code'

const IN_90_DAYS = new Date(Date.now() + 90 * 86_400_000).toISOString()

// ── Entropi på private koder ────────────────────────────────────────────────

test('generert kode har riktig lengde og alfabet', () => {
  const code = generateAccessCode()
  assert.equal(code.length, PERSONAL_CODE_LENGTH)
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/)
  // Forvekslingstegn skal aldri forekomme — koder leses opp og skrives av folk.
  assert.ok(!/[01ILO]/.test(code))
})

test('koder gjentar seg ikke — 5000 trekk gir 5000 ulike', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 5000; i++) seen.add(generateAccessCode())
  assert.equal(seen.size, 5000)
})

test('fordelingen er jevn — ingen modulo-skjevhet mot starten av alfabetet', () => {
  // 31 går ikke opp i 256: byte-verdiene 0–255 gir residuene 0–7 (bokstavene
  // A–H) én ekstra treff hver (256 = 8×31 + 8) hvis man bruker rå `byte % 31`.
  // Det gjør A–H 9/256 sannsynlige mot 8/256 for resten — 12,5 % skjevere,
  // og mot et jevnt "forventet"-mål (n/31) blir det et avvik på ca. 9,0 %.
  // Forkastningsutvalget i generateAccessCode() skal fjerne akkurat dette.
  //
  // Antall samples og toleranse under er utledet, ikke gjettet:
  // Hvert tegn er (ved korrekt forkastningsutvalg) uavhengig og likt fordelt
  // over 31 symboler, så relativt standardavvik for én bøtte er
  // sqrt((1-p)/(N·p)) = sqrt(30/N) der N = totalt antall trekte tegn.
  // Med SAMPLES = 10 000 koder × 12 tegn = 120 000 trekk blir
  // sqrt(30/120000) ≈ 1,58 %. En toleranse på 7,5 % ligger da ca. 4,7
  // standardavvik unna null — falsk positiv er astronomisk usannsynlig selv
  // med 31 sammenlignede bøtter (~1 av 1,5 millioner kjøringer) — men
  // fortsatt godt under det ekte skjevhets-signalet på ~9,0 %, som i tillegg
  // rammer 8 bokstaver samtidig (enda høyere fangst-sannsynlighet).
  const SAMPLES = 10_000
  const counts = new Map<string, number>()
  for (let i = 0; i < SAMPLES; i++) {
    for (const ch of generateAccessCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  }
  const values = [...counts.values()]
  const expected = (SAMPLES * PERSONAL_CODE_LENGTH) / 31
  const maxDeviation = Math.max(...values.map(v => Math.abs(v - expected) / expected))
  assert.ok(maxDeviation < 0.075, `for skjev fordeling: ${(maxDeviation * 100).toFixed(1)} %`)
})

test('lengden kan settes — org-trial-koder bruker 8', () => {
  assert.equal(generateAccessCode(8).length, 8)
})

// ── Delte koder: bruksgrenser er obligatoriske ──────────────────────────────

test('delt kode med kodeord, tak og frist godtas', () => {
  const res = buildAccessCode({
    code_type: 'shared',
    code: 'fredagsquiz',
    description: 'Belønning til Facebook-gruppa',
    max_uses: 455,
    valid_until: IN_90_DAYS,
    duration_days: 60,
  })
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.row.code, 'FREDAGSQUIZ', 'kodeord normaliseres til store bokstaver')
  assert.equal(res.row.code_type, 'shared')
  assert.equal(res.row.max_uses, 455)
  assert.equal(res.row.used_count, 0)
})

test('delt kode UTEN maks antall innløsninger avvises', () => {
  const res = buildAccessCode({
    code_type: 'shared',
    code: 'FREDAGSQUIZ',
    description: 'Belønning',
    valid_until: IN_90_DAYS,
  })
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.match(res.error, /maks antall/i)
})

test('delt kode UTEN utløpsdato avvises', () => {
  const res = buildAccessCode({
    code_type: 'shared',
    code: 'FREDAGSQUIZ',
    description: 'Belønning',
    max_uses: 455,
  })
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.match(res.error, /utløpsdato/i)
})

test('delt kode uten kodeord avvises', () => {
  const res = buildAccessCode({ code_type: 'shared', description: 'Testkode', max_uses: 10, valid_until: IN_90_DAYS })
  assert.equal(res.ok, false)
})

test('urimelige tak avvises', () => {
  for (const max_uses of [0, -5, MAX_USES_CEILING + 1, 'mange']) {
    const res = buildAccessCode({
      code_type: 'shared', code: 'KODE', description: 'Testkode', max_uses, valid_until: IN_90_DAYS,
    })
    assert.equal(res.ok, false, `max_uses=${max_uses} skulle vært avvist`)
  }
})

test('kodeord med mellomrom eller markup avvises', () => {
  for (const code of ['GRATIS QUIZ', '<b>KODE</b>', 'AB', 'K'.repeat(33)]) {
    const res = buildAccessCode({
      code_type: 'shared', code, description: 'Testkode', max_uses: 10, valid_until: IN_90_DAYS,
    })
    assert.equal(res.ok, false, `${JSON.stringify(code)} skulle vært avvist`)
  }
})

// ── Private koder: alltid generert ──────────────────────────────────────────

test('privat kode genereres og kan ikke overstyres med fritekst', () => {
  const res = buildAccessCode({
    code_type: 'personal',
    code: 'LETTGJETTET',
    description: 'Gave til Marte',
    duration_days: 365,
  })
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.notEqual(res.row.code, 'LETTGJETTET', 'fritekst skal ignoreres for private koder')
  assert.equal(res.row.code.length, PERSONAL_CODE_LENGTH)
  assert.equal(res.row.max_uses, 1, 'privat kode er låst til én innløsning')
  assert.equal(res.row.code_type, 'personal')
})

test('privat kode trenger ikke utløpsdato', () => {
  const res = buildAccessCode({ code_type: 'personal', description: 'Gave til Marte' })
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.row.valid_until, null)
})

test('to private koder er aldri like', () => {
  const a = buildAccessCode({ code_type: 'personal', description: 'Gave 1' })
  const b = buildAccessCode({ code_type: 'personal', description: 'Gave 2' })
  assert.ok(a.ok && b.ok)
  if (!a.ok || !b.ok) return
  assert.notEqual(a.row.code, b.row.code)
})

// ── Felles ──────────────────────────────────────────────────────────────────

test('beskrivelse er påkrevd for begge typer', () => {
  assert.equal(buildAccessCode({ code_type: 'personal', description: '' }).ok, false)
  assert.equal(buildAccessCode({ code_type: 'shared', code: 'KODE', description: ' ', max_uses: 5, valid_until: IN_90_DAYS }).ok, false)
})

test('ukjent code_type behandles som delt — den strengeste av de to', () => {
  const res = buildAccessCode({ code_type: 'tull', code: 'KODE', description: 'Testkode' })
  assert.equal(res.ok, false, 'faller til delt, som krever grenser')
})

test('ekstra felt i bodyen kan ikke smugles inn i raden', () => {
  const res = buildAccessCode({
    code_type: 'shared', code: 'KODE', description: 'Testkode', max_uses: 5, valid_until: IN_90_DAYS,
    // Forsøk på mass assignment — ruten satte tidligere inn hele bodyen rått.
    used_count: -999, is_active: false, id: 'kapret-id',
  } as Record<string, unknown>)
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.row.used_count, 0)
  assert.equal(res.row.is_active, true)
  assert.ok(!('id' in res.row))
})

// ── Endring av eksisterende kode (PATCH) ────────────────────────────────────
// Samme feilklasse som over, på den andre siden av kodens levetid: PATCH-ruten
// gjorde `update(body)` rått fram til 1. august.

test('feltene admin faktisk endrer går gjennom', () => {
  const res = buildAccessCodePatch(
    { is_active: false, description: '  Utvidet frist  ', max_uses: 500, valid_until: IN_90_DAYS },
    'shared',
  )
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.patch.is_active, false)
  assert.equal(res.patch.description, 'Utvidet frist', 'beskrivelse trimmes')
  assert.equal(res.patch.max_uses, 500)
  assert.equal(res.patch.valid_until, IN_90_DAYS)
})

test('av/på-bryteren alene er en gyldig patch — det er den admin-UI-et sender', () => {
  const res = buildAccessCodePatch({ is_active: true }, 'shared')
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.deepEqual(res.patch, { is_active: true }, 'kun feltet som ble sendt skrives')
})

test('identitets- og integritetsfelt kan ikke endres etter opprettelse', () => {
  for (const field of ['code', 'code_type', 'used_count', 'duration_days', 'id', 'created_at']) {
    const res = buildAccessCodePatch({ [field]: 'hva som helst' }, 'shared')
    assert.equal(res.ok, false, `${field} skulle vært avvist`)
    if (res.ok) return
    assert.match(res.error, new RegExp(field), 'feilmeldingen navngir feltet')
  }
})

test('et lovlig felt redder ikke et ulovlig felt i samme kall', () => {
  // Uten en eksplisitt sperre ville hele bodyen gått rett i update() —
  // is_active er avledningen, used_count er det som faktisk skulle skrives.
  const res = buildAccessCodePatch({ is_active: false, used_count: 0 }, 'shared')
  assert.equal(res.ok, false)
})

test('privat kode kan ikke få hevet taket i ettertid', () => {
  const res = buildAccessCodePatch({ max_uses: 5000 }, 'personal')
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.match(res.error, /én innløsning/i)
})

test('delt kode kan ikke miste taket eller fristen via PATCH', () => {
  assert.equal(buildAccessCodePatch({ max_uses: null }, 'shared').ok, false)
  assert.equal(buildAccessCodePatch({ max_uses: 0 }, 'shared').ok, false)
  assert.equal(buildAccessCodePatch({ max_uses: MAX_USES_CEILING + 1 }, 'shared').ok, false)
  assert.equal(buildAccessCodePatch({ valid_until: null }, 'shared').ok, false)
  assert.equal(buildAccessCodePatch({ valid_until: '' }, 'shared').ok, false)
})

test('privat kode kan gjøres permanent — der er frist valgfri', () => {
  const res = buildAccessCodePatch({ valid_until: null }, 'personal')
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.patch.valid_until, null)
})

test('ugyldige verdier på lovlige felt avvises', () => {
  assert.equal(buildAccessCodePatch({ is_active: 'ja' }, 'shared').ok, false, 'is_active må være boolean')
  assert.equal(buildAccessCodePatch({ description: 'A' }, 'shared').ok, false, 'for kort beskrivelse')
  assert.equal(buildAccessCodePatch({ description: 'A'.repeat(201) }, 'shared').ok, false, 'for lang beskrivelse')
  assert.equal(buildAccessCodePatch({ valid_until: 'i morgen' }, 'shared').ok, false, 'ugyldig dato')
})

test('tom eller ikke-objekt body avvises i stedet for å skrive ingenting stille', () => {
  assert.equal(buildAccessCodePatch({}, 'shared').ok, false)
  assert.equal(buildAccessCodePatch(null, 'shared').ok, false)
  assert.equal(buildAccessCodePatch([{ is_active: false }], 'shared').ok, false)
  assert.equal(buildAccessCodePatch('is_active=false', 'shared').ok, false)
})
