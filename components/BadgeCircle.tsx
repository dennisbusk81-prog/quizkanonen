/**
 * Delt merke-ikon (krone/pil/flamme/lyn/medalje) — trukket ut 26. juli 2026.
 * Fantes tidligere duplisert identisk i app/leaderboard/[id]/page.tsx og
 * components/SeasonLeaderboard.tsx (sistnevnte manglet 'pil', siden den ikke
 * har noe "mest fremgang"-konsept). Samme utrekk-begrunnelse som
 * components/ResultsTable.tsx fikk tidligere i dag: en tredje kopi av det
 * samme ville blitt nok en kilde til drift mellom sidene.
 */
export type BadgeKind = 'krone' | 'pil' | 'flamme' | 'lyn' | 'medalje'

export default function BadgeCircle({ badge, size = 18 }: { badge: BadgeKind; size?: number }) {
  const bg = '#c9a84c'
  const iconSize = Math.round(size * 0.65)
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none">
        {badge === 'krone'   && <path d="M2 8L4 3L8 6L12 3L14 8H2Z" fill="#1a1c23"/>}
        {badge === 'pil'     && <path d="M8 3L13 10H3L8 3Z" fill="white"/>}
        {badge === 'flamme'  && <path d="M8 2C8 2 12 5 12 8.5C12 11 10 13 8 14C6 13 4 11 4 8.5C4 5 8 2 8 2Z" fill="white"/>}
        {badge === 'lyn'     && <path d="M10 2L5 9H9L6 14L13 6H9L10 2Z" fill="white"/>}
        {badge === 'medalje' && <circle cx="8" cy="8" r="4" fill="white"/>}
      </svg>
    </div>
  )
}
