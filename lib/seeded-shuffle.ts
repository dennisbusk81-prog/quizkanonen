// ── Deterministisk, seedet stokking ──────────────────────────────────────────
// Delt mellom server og klient slik at begge sider kan utlede NØYAKTIG samme
// rekkefølge av samme seed — uten å duplisere PRNG-logikken to steder.
//
// Brukes til:
//   - spørsmålsrekkefølge per attempt   (app/api/quiz/[id]/questions/route.ts)
//   - svaralternativenes visningsrekkefølge (samme rute, + klient-fallback)
//
// Hvorfor ikke Math.random(): en tilfeldig rekkefølge er ikke idempotent. Kjøres
// utledningen to ganger for samme spørsmål, får man to ulike rekkefølger — og
// skjer det mens spørsmålet er synlig, bytter svaralternativene plass under
// brukerens finger og feil svar registreres. Med en seedet PRNG er rekkefølgen
// en ren funksjon av seeden, så gjentatte kall er umulige å skille fra ett kall.
//
// Merk også: `[...arr].sort(() => Math.random() - 0.5)` er ikke bare
// ikke-idempotent, den er også målbart skjev (ikke uniform over permutasjonene).
// Fisher-Yates under er uniform.

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(arr: T[], seedStr: string): T[] {
  const seedFn = xmur3(seedStr)
  const rand = mulberry32(seedFn())
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Alle fire alternativ-bokstavene. Rekkefølgen her er kun utgangspunktet som
// stokkes — den sier ingenting om hvor fasiten ligger.
export const ALL_OPTION_LETTERS = ['A', 'B', 'C', 'D']

// Seeden for et spørsmåls alternativ-rekkefølge. Per attempt (så to spillere ser
// ulik rekkefølge) og per spørsmål (så rekkefølgen ikke gjentas gjennom quizen).
export function optionOrderSeed(attemptId: string | null, questionId: string): string {
  return attemptId ? `${attemptId}:${questionId}` : questionId
}
