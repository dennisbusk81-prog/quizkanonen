import { randomBytes } from 'crypto'

// ── Verdikoder: to sikkerhetsmodeller ────────────────────────────────────────
//
// DELT KODE ('shared') — f.eks. en belønning til hele Facebook-gruppa.
//   Skal være lesbar og minneverdig, og er MENT å deles åpent. Gjettbarhet er
//   ikke forsvaret; koden er per definisjon kjent av mange. Forsvaret er
//   bruksgrenser: maks antall innløsninger, utløpsdato, og én per konto
//   (sistnevnte håndheves i databasen, se migrasjonen).
//
// PRIVAT KODE ('personal') — f.eks. premie til én konkurransevinner.
//   Skal ikke kunne gjettes av utenforstående, og genereres derfor tilfeldig.
//   Fritekst er ikke tillatt her: et menneskeskrevet «ord» har i praksis ingen
//   entropi (FREDAG2025 er et ordbokstreff, ikke en hemmelighet).

export type AccessCodeType = 'shared' | 'personal'

// Uten lett forvekslelige tegn (0/O, 1/I/L) — koder blir lest opp og skrevet av
// mennesker. 31 tegn.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

// 12 tegn × log2(31) ≈ 59,5 bits. Til sammenligning har et menneskevalgt ord
// som «FREDAG2025» tilnærmet null effektiv entropi.
export const PERSONAL_CODE_LENGTH = 12

// Grensene under er bevisst romslige — de skal hindre tastefeil og
// rømte-null-typer («max_uses: 100000»), ikke overstyre skjønnet til admin.
export const MAX_USES_CEILING = 5000
export const DURATION_DAYS_CEILING = 3650

/**
 * Kryptografisk tilfeldig kode fra et menneskevennlig alfabet.
 *
 * Bruker forkastningsutvalg (rejection sampling) i stedet for `% 31`: 256 er
 * ikke delelig med 31, så en ren modulo ville gjort de første 8 tegnene i
 * alfabetet merkbart mer sannsynlige og spist av entropien.
 */
export function generateAccessCode(length: number = PERSONAL_CODE_LENGTH): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length // 248
  let out = ''
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue // ville skjevfordelt — trekk på nytt
      out += ALPHABET[byte % ALPHABET.length]
      if (out.length === length) break
    }
  }
  return out
}

// Samme form som selve genereringen — brukt til å validere fritekstkoder.
const SHARED_CODE_RE = /^[A-Z0-9ÆØÅ]{4,32}$/

export type AccessCodeInput = {
  code_type?: unknown
  code?: unknown
  description?: unknown
  duration_days?: unknown
  max_uses?: unknown
  valid_until?: unknown
}

export type AccessCodeRow = {
  code: string
  description: string
  code_type: AccessCodeType
  duration_days: number | null
  max_uses: number
  valid_until: string | null
  used_count: number
  is_active: boolean
}

export type AccessCodeResult =
  | { ok: true; row: AccessCodeRow }
  | { ok: false; error: string }

/**
 * Validerer og normaliserer en ny verdikode.
 *
 * Ren funksjon — ingen I/O — slik at reglene kan testes direkte, og slik at
 * admin-ruten ikke lenger kan gjøre `insert(body)` med hva som helst i.
 */
export function buildAccessCode(input: AccessCodeInput): AccessCodeResult {
  const codeType: AccessCodeType = input.code_type === 'personal' ? 'personal' : 'shared'

  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (description.length < 2) {
    return { ok: false, error: 'Beskrivelse må fylles ut (minst 2 tegn).' }
  }
  if (description.length > 200) {
    return { ok: false, error: 'Beskrivelsen kan maks være 200 tegn.' }
  }

  const durationDays = parseOptionalInt(input.duration_days)
  if (durationDays === 'invalid' || (durationDays !== null && (durationDays < 1 || durationDays > DURATION_DAYS_CEILING))) {
    return { ok: false, error: `Varighet må være mellom 1 og ${DURATION_DAYS_CEILING} dager, eller stå tom for permanent.` }
  }

  const validUntil = parseValidUntil(input.valid_until)
  if (validUntil === 'invalid') {
    return { ok: false, error: 'Ugyldig utløpsdato.' }
  }

  if (codeType === 'personal') {
    // Privat kode: alltid generert, aldri fritekst. max_uses er låst til 1 —
    // det er nettopp det som gjør den privat.
    return {
      ok: true,
      row: {
        code: generateAccessCode(),
        description,
        code_type: 'personal',
        duration_days: durationDays,
        max_uses: 1,
        valid_until: validUntil,
        used_count: 0,
        is_active: true,
      },
    }
  }

  // ── Delt kode ──────────────────────────────────────────────────────────────
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : ''
  if (!code) {
    return { ok: false, error: 'Delte koder må ha et kodeord.' }
  }
  if (!SHARED_CODE_RE.test(code)) {
    return { ok: false, error: 'Kodeordet kan bare inneholde store bokstaver og tall (4–32 tegn).' }
  }

  // Bruksgrensene er IKKE valgfrie for en delt kode. En kode som deles åpent med
  // mange er kjent av mange for alltid — det er taket og fristen som beskytter
  // den, ikke hemmeligholdet.
  const maxUses = parseOptionalInt(input.max_uses)
  if (maxUses === 'invalid' || maxUses === null) {
    return { ok: false, error: 'Delte koder må ha et maks antall innløsninger.' }
  }
  if (maxUses < 1 || maxUses > MAX_USES_CEILING) {
    return { ok: false, error: `Maks antall innløsninger må være mellom 1 og ${MAX_USES_CEILING}.` }
  }
  if (!validUntil) {
    return { ok: false, error: 'Delte koder må ha en utløpsdato.' }
  }

  return {
    ok: true,
    row: {
      code,
      description,
      code_type: 'shared',
      duration_days: durationDays,
      max_uses: maxUses,
      valid_until: validUntil,
      used_count: 0,
      is_active: true,
    },
  }
}

function parseOptionalInt(value: unknown): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(n)) return 'invalid'
  return n
}

function parseValidUntil(value: unknown): string | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return 'invalid'
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return 'invalid'
  return new Date(ms).toISOString()
}
