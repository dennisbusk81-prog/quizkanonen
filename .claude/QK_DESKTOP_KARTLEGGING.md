# Quizkanonen — Desktop-responsivitet kartlegging
Utført: 21. juni 2026 | Metode: kodeanalyse (statisk) | Bredder: 1280/1440/1920px

---

## Oppsummering

Ingen kritiske feil. Ett tydelig middels funn (nav-/innhold-mismatch). Resten er kosmetisk.
Ingen horisontal scroll observert. Ingen to-gule-brudd på desktop-bredder.

---

## Funn per side

### / (forside)

**[MIDDELS] Nav max-width (720px) vs. sideinnhold max-width (900px)**
- `.qk-nav-inner` stoppes ved 720px, `.qk-page` ved 900px. Begge er `margin: 0 auto`.
- Konsekvens: på 1280px+ starter sideinnholdets venstre kant 90px *til venstre* for
  nav-logoens venstre kant. Quiz-kortet stikker ut på begge sider av nav-baren.
- Synlig skjevhet — særlig merkbar på 1440–1920px der gapet er tydelig.
- Fix: endre `.qk-nav-inner { max-width: 900px }` for å matche sideinnholdet.

**[KOSMETISK] Hero-tekst liten i forhold til skjermbredde på ultrawide**
- `.qk-hero-title` bruker `clamp(28px, 6vw, 44px)`. På 1920px låser fonten på max 44px
  men er omgitt av mye tom plass i 900px-containeren.
- Ikke et funksjonelt problem — oppfattes mer som en landing-side-estetikk.

**[KOSMETISK] Ingen desktop-grid-utvidelse av faktaikoner/quiz-kort**
- Alt er single-column i 900px containeren. Ser rimelig ut, men innholdet er
  ikke optimalisert for tokolonner på desktop (f.eks. hero + kort side om side).
- Ikke planlagt — notering kun for fremtidig design-iterasjon.

---

### /quiz/[id] (spillskjerm + mellomskjerm)

**[KOSMETISK] `.qk-box { max-width: 680px }` — ingen desktop-problemer**
- Spillboksen er sentrert og smal — passer godt for fokusert spillopplevelse.
- `@media (min-width: 769px)` gir økt padding og litt større font. OK.

**[KOSMETISK] Fixed animasjonseffekter (ring-pulse, score-pop) posisjoneres
  på klikk-koordinater**
- `.qk-ring-el` og `.qk-score-pop-el` bruker `position: fixed` og plasseres
  dynamisk på klikk-XY via JS. På desktop er svarene innenfor 680px spillboks
  som er sentrert — animasjonene oppstår der bruker faktisk klikker. OK i praksis.
- `.qk-streak-msg-el` er hardkodet `left: 50%; top: 40%` — alltid viewport-sentrum.
  Siden spillboksen er viewport-sentrert er dette akseptabelt.

**[KOSMETISK] QuizInterlude (mellomskjerm) — `maxWidth: 360` sentrert**
- Veldig smal på desktop, men det er en bevisst fokusert mellomskjerm. OK.

---

### /leaderboard/[id]

**Ingen funn.**
- `maxWidth: 680`, sentrert. `@media (min-width: 769px)` i podiumStyles
  gir horisontalt resultat-layout og økt padding. Eksisterende desktop-tilpasning.

---

### /toppliste

**Ingen funksjonelle funn.**
- `maxWidth: 900px`. SeasonLeaderboard bruker `width: 100%` for rader —
  fyller containeren riktig på desktop.
- Tab-raden (5 faner) vises i bredden uten scroll på desktop. OK.

---

### /liga/[slug]

**Ingen funn.**
- `maxWidth: 680px`. Sentrert enkeltkolonne. Fungerer godt på desktop.
- Invitasjons-input-rad (input + kopier-knapp) er horisontalt — ser riktig ut på desktop.

---

### /org/[slug] (bedriftstoppliste)

**Ingen funn.**
- `maxWidth: 900px`. Sticky nav har `max-width: 900px margin: 0 auto` —
  konsistent med innholdets bredde. Ingen mismatch (ulikt forsiden).

---

### /org/[slug]/admin

**Ingen funn.**
- `.oa-page { max-width: 900px }`. Faner, statistikkstripe og tabeller
  bruker `width: 100%` innenfor containeren.
- `@media (max-width: 580px)` bretter statistikkstripe og winners-grid til
  enkeltkolonne — disse er ikke aktive på desktop. OK.

---

### /bedrift

**[KOSMETISK] 4-kolonners pakke-grid på 900px er tett**
- `grid-template-columns: repeat(4, minmax(0, 1fr))` gir ~210px per kolonne
  på 900px container (med 12px gaps). Kortene har pakkenavn, pris, feature-liste
  og knapp — leselig men kompakt.
- Ingen overflow eller klipping observert (bruker `minmax(0,1fr)` korrekt).
- En 2+2-kolonne-layout på desktop ville gitt mer luft. Lav prioritet.

---

### /bedrift/registrer

**Ingen funn.**
- `maxWidth: 500px` sentrert. Formfokusert side — smal bredde er intentional.

---

### /premium

**[KOSMETISK] Svært smal container (480px) på ultrawide**
- `maxWidth: 480px` — intensjonelt fokusert funnel-side.
- På 1920px er innholdet er lite "øy" midt på skjermen. Ikke en bug.

---

### /founders

**Ingen funn.**
- `maxWidth: 520px` sentrert med `alignItems: center` — samme som premium.

---

### /admin/quizzes/new (spørsmålseditor)

**Ingen funn.**
- `.nq-page { max-width: 680px }`. Sticky header fungerer på desktop.
- Responsivitet er ikke kritisk for admin-sider.

---

## Ingen horisontal scroll observert

Alle sider bruker `overflow-x: hidden` eller containere som ikke overskyder viewport.
Bedrift-tabellen har `overflow-x: auto` + `min-width: 480px` for å håndtere smal mobil. OK.

## Ingen to-gule-brudd på desktop-bredder

Sjekket alle sider — én-gull-per-skjerm-regelen overholdes konsistent på desktop-bredder.

---

## Foreslått fiksrekkefølge

| # | Funn | Alvorlighet | Estimert arbeid |
|---|---|---|---|
| 1 | Forsiden: nav max-width 720 → 900 | Middels | 1 linje |
| 2 | Bedrift: 4-kol → 2-kol grid på desktop | Kosmetisk | ~10 linjer CSS |
| 3 | Hero clamp-maks / layout-forbedring | Kosmetisk | Større designjobb |
