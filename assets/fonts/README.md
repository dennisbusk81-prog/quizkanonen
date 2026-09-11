# Fontfiler for server-side PNG-rendering (satori)

Disse tre TTF-ene finnes KUN for `app/admin/resultatkort/[quizId]/route.ts`.
Resten av appen skal fortsatt bruke `next/font` i `app/layout.tsx` — ikke
bytt noen CSS-referanse over på disse filene.

## Hvorfor de ligger her i det hele tatt

`next/font/google` laster ned og subsetter fontene ved build og legger dem i
`.next/static/media` som **woff2**. Satori (motoren bak `next/og`) leser
`ttf`, `otf` og `woff` — **ikke woff2** — og trenger dessuten en `ArrayBuffer`,
ikke en CSS-regel. Bundelen til `next/font` er altså ubrukelig for satori, og
før denne mappa fantes hadde repoet ingen fontfiler i det hele tatt
(`public/` har bare ikoner og SVG-er).

## Hvor de kommer fra

Statiske instanser fra Google Fonts, hentet via css2-API-et med en UA som
ikke støtter woff2 (det er det som gjør at API-et svarer med `.ttf`):

    curl -A "Mozilla/5.0 (Windows NT 5.1)" \
      "https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@700&family=Instrument+Sans:wght@400;700"

Merk at `google/fonts`-repoet på GitHub kun har VARIABLE ttf-er
(`LibreBaskerville[wght].ttf`). Satori bruker ikke variasjonsakser — den
ville rendret alt i aksens standardverdi, altså 400, og «bold» ville blitt
syntetisert eller uteblitt. Derfor statiske instanser, én fil per vekt.

| Fil | Familie | Vekt |
|---|---|---|
| `LibreBaskerville-Bold.ttf` | Libre Baskerville | 700 |
| `InstrumentSans-Regular.ttf` | Instrument Sans | 400 |
| `InstrumentSans-Bold.ttf` | Instrument Sans | 700 |

Til sammen ~199 KB. `ImageResponse` har et tak på 500 KB for JSX + CSS +
fonter + assets til sammen, så det er ikke plass til mange flere vekter.
Trenger kortet en mellomvekt, bytt heller ut enn å legge til.

## Lisens

Begge familiene er SIL Open Font License 1.1. Lisenstekstene ligger ved som
`LibreBaskerville-OFL.txt` og `InstrumentSans-OFL.txt` og skal følge filene.
