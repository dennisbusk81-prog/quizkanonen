// Henter første faktiske bokstav i et navn for avatar-visning. Rått string[0]/
// charAt(0) plukker første UTF-16-kodeenhet, som knekker for navn som starter
// med emoji (surrogate-par eller sammensatte emoji-sekvenser gir et brukket
// tegn). \p{L} med u-flagget matcher hele Unicode-kodepunkt, så emoji og andre
// symboler foran eller inni navnet hoppes riktig over.
export function getAvatarInitial(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback
  const match = name.match(/\p{L}/u)
  return match ? match[0].toUpperCase() : fallback
}
