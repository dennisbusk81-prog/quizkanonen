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

// ── Endring av en eksisterende kode ─────────────────────────────────────────
//
// PATCH-ruten gjorde tidligere `update(body)` rått, akkurat som POST gjorde
// `insert(body)` før 26. juli. Det betød at et PATCH-kall kunne sette
// code_type, code eller used_count til hva som helst — altså gå utenom hele
// modellen over: gjøre en privat kode «shared» med 5000 plasser, nullstille
// forbruket på en oppbrukt kode, eller bytte selve kodeordet.
//
// Her er hvilke felt som faktisk KAN endres etter opprettelse. Alt annet er
// avvist eksplisitt, ikke stille ignorert — en admin som tror hun endret
// kodeordet skal få vite at hun ikke gjorde det.
export const PATCHABLE_ACCESS_CODE_FIELDS = [
  'is_active',
  'description',
  'max_uses',
  'valid_until',
] as const

// LÅST etter opprettelse, og hvorfor:
//   code, code_type — kodens identitet. En kode som er delt ut kan ikke bytte
//     sikkerhetsmodell i ettertid uten at forsvaret den ble laget med faller.
//   used_count      — forbrukstelleren. Skrives av redeem_access_code() i
//     samme transaksjon som innløsningen; håndredigering ville løsnet den fra
//     radene i access_code_redemptions.
//   duration_days   — hvor lang Premium-periode koden gir. Innløsninger som
//     alt har skjedd har regnet ut sin egen expires_at fra den verdien, så en
//     endring i ettertid ville gitt to grupper med ulik dekning fra samme
//     kode. Lag heller en ny kode.
export type AccessCodePatch = Partial<
  Pick<AccessCodeRow, 'is_active' | 'description' | 'max_uses' | 'valid_until'>
>

export type AccessCodePatchResult =
  | { ok: true; patch: AccessCodePatch }
  | { ok: false; error: string }

/**
 * Validerer en endring av en eksisterende verdikode.
 *
 * Ren funksjon, som `buildAccessCode`. `codeType` leses fra raden som skal
 * endres — reglene er ulike for de to modellene, og typen kan ikke utledes av
 * bodyen (den er nettopp ikke lov å sende).
 */
export function buildAccessCodePatch(input: unknown, codeType: AccessCodeType): AccessCodePatchResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Ugyldig body.' }
  }

  const body = input as Record<string, unknown>
  const keys = Object.keys(body)
  if (keys.length === 0) {
    return { ok: false, error: 'Ingen felter å oppdatere.' }
  }

  const allowed = PATCHABLE_ACCESS_CODE_FIELDS as readonly string[]
  const forbidden = keys.find(k => !allowed.includes(k))
  if (forbidden) {
    return { ok: false, error: `Feltet «${forbidden}» kan ikke endres etter at koden er opprettet.` }
  }

  const patch: AccessCodePatch = {}

  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') {
      return { ok: false, error: 'is_active må være true eller false.' }
    }
    patch.is_active = body.is_active
  }

  if ('description' in body) {
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (description.length < 2) {
      return { ok: false, error: 'Beskrivelse må fylles ut (minst 2 tegn).' }
    }
    if (description.length > 200) {
      return { ok: false, error: 'Beskrivelsen kan maks være 200 tegn.' }
    }
    patch.description = description
  }

  if ('max_uses' in body) {
    // Private koder er private nettopp fordi de bare kan brukes én gang. Å
    // heve taket i ettertid ville gjort premien til én vinner til en kode
    // flere kunne løse inn.
    if (codeType === 'personal') {
      return { ok: false, error: 'Private koder er låst til én innløsning og kan ikke endres.' }
    }
    const maxUses = parseOptionalInt(body.max_uses)
    if (maxUses === 'invalid' || maxUses === null) {
      return { ok: false, error: 'Delte koder må ha et maks antall innløsninger.' }
    }
    if (maxUses < 1 || maxUses > MAX_USES_CEILING) {
      return { ok: false, error: `Maks antall innløsninger må være mellom 1 og ${MAX_USES_CEILING}.` }
    }
    patch.max_uses = maxUses
  }

  if ('valid_until' in body) {
    const validUntil = parseValidUntil(body.valid_until)
    if (validUntil === 'invalid') {
      return { ok: false, error: 'Ugyldig utløpsdato.' }
    }
    // Samme regel som ved opprettelse: en delt kode uten frist er en kode som
    // aldri slutter å virke. Fristen kan flyttes, men ikke fjernes.
    if (validUntil === null && codeType === 'shared') {
      return { ok: false, error: 'Delte koder må ha en utløpsdato.' }
    }
    patch.valid_until = validUntil
  }

  return { ok: true, patch }
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
