// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateAccessCode,
  buildAccessCode,
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
  // 31 går ikke opp i 256. En naiv `byte % 31` gir de 8 første tegnene ~13 %
  // høyere sannsynlighet. Forkastningsutvalget skal fjerne det.
  const counts = new Map<string, number>()
  for (let i = 0; i < 2000; i++) {
    for (const ch of generateAccessCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  }
  const values = [...counts.values()]
  const expected = (2000 * PERSONAL_CODE_LENGTH) / 31
  const maxDeviation = Math.max(...values.map(v => Math.abs(v - expected) / expected))
  assert.ok(maxDeviation < 0.12, `for skjev fordeling: ${(maxDeviation * 100).toFixed(1)} %`)
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
