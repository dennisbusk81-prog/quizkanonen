// «25% riktige (1 av 4)» under kategorinavnet på /historikk.
//
// All beslutningslogikk ligger i lib/kategori-tall.ts, ikke her: denne filen
// er .tsx og kan derfor ikke kjøres av testsuiten (Node kan fjerne
// TypeScript-typer, men ikke kompilere JSX). Feilen 4. august 2026 — kortene
// viste «% riktige ( av )» — satt nettopp i en vakt som lå i en .tsx-fil bak
// innlogging og Premium, der ingen test kunne nå den. Det som kan gå galt,
// skal ligge i lib/.

import { kategoriTall } from '@/lib/kategori-tall'

const style = {
  // Prosenten er tallet BAK påstanden, ikke selve påstanden — den skal leses
  // etter kategorinavnet, så den er lysegrå brødtekst og ikke et andre
  // gull-element i samme kort.
  pct:   { fontSize: 13, fontWeight: 600, color: '#e8e4dd', marginBottom: 6 },
  // Råtallene, dempet på samme linje. Terskelen er 3 svar, så «100 %» er ofte
  // 3 av 3 — uten nevneren leser prosenten mye sterkere enn den har dekning
  // for. Målt mot prod 4. august 2026: 3 av de 4 mest aktive spillerne fikk
  // Kunst & Kultur 3/3 som sterkeste kategori.
  count: { fontSize: 12, fontWeight: 400, color: '#918f8a' },
} as const

export type KategoriTallProps = {
  prosent: number | null | undefined
  riktige: number | null | undefined
  besvart: number | null | undefined
}

export default function KategoriTall(props: KategoriTallProps) {
  const tall = kategoriTall(props.prosent, props.riktige, props.besvart)
  if (!tall) return null
  return (
    <div style={style.pct}>
      {tall.prosent}% riktige{' '}
      <span style={style.count}>({tall.riktige} av {tall.besvart})</span>
    </div>
  )
}
