# Quizkanonen — Claude Code kontekst

## PROSJEKT
Solo-gründer bygger Quizkanonen (quizkanonen.no) — en ukentlig quiz-plattform
som skal erstatte Kahoot for en etablert Facebook-gruppe (400 medlemmer).
Nordisk marked. Budsjett nær null i startfasen.

---

## TEKNISK STACK — IKKE ENDRE
- **Frontend + backend:** Next.js (App Router, TypeScript) — aldri Pages Router
- **Database + auth:** Supabase (PostgreSQL, RLS aktivert)
- **Hosting:** Vercel (auto-deploy fra GitHub)
- **Betaling:** Stripe (Test Mode — ikke bytt til live uten eksplisitt beskjed)
- **Styling:** Ingen Tailwind — inline CSS via konstantobjekter

Arbeidsflyt: Claude Code pusher til git → Vercel deployer automatisk.

---

## DESIGNSYSTEM — FØLG NØYAKTIG
Les `app/quiz/[id]/page.tsx` som referanse før du starter ny feature.

### Farger
| Rolle | Verdi |
|---|---|
| Bakgrunn | `#1a1c23` |
| Kort | `#21242e` |
| Border | `#2a2d38` |
| Gull | `#c9a84c` |
| Titler | `#ffffff` |
| Brødtekst | `#e8e4dd` |
| Hint/meta | `#7a7873` |
| **FORBUDT** | `#9a9590`, `#6a6860`, `#8a8fa8` |

### Typografi
- Titler: `Libre Baskerville` (serif)
- Brødtekst: `Instrument Sans`

### Knapper
- Primær (gul fylt): `background #c9a84c`, `color #1a1c23`, `padding 10px 28px`, `width auto`
- Aldri to gule knapper på samme skjerm
- Sekundær: outline, transparent bakgrunn

### Border-radius
- Kort: `16px`
- Knapper: `10px`

### Luft og padding
- Kort padding: minimum `24px 20px`, gjerne `28px`
- Mer luft er alltid bedre enn tettere
- Seksjoner skal ha tydelig visuelt skille med margin-bottom

### Lenker
- Lenker som krever klikk: `#e8e4dd` — aldri `#7a7873` (for mørk på mobil)
- Unntak: hint-tekst og metadata som ikke krever klikk kan være `#7a7873`

### Regler
- Ingen Tailwind
- Ingen emoji i UI — SVG der nødvendig
- Ingen hardkodede farger utenfor systemet ovenfor

---

## ARKITEKTUR OG MØNSTRE

### Auth
- Supabase auth med Google OAuth + magic link
- `lib/auth.ts` for signIn, signOut, getSession, getProfile
- `lib/supabase-admin.ts` er server-only (service role)
- Admin-auth: passord i `ADMIN_PASSWORD` env-var, sesjon i localStorage 8 timer

### Database-tabeller (eksisterende)
`quizzes`, `questions`, `attempts`, `attempt_answers`, `played_log`,
`access_codes`, `admin_users`, `site_settings`, `profiles`,
`organizations`, `organization_members`, `leagues`, `league_members`

### Miljøvariabler (ligger i Vercel — ikke hardkod)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `NEXT_PUBLIC_SITE_URL`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`

---

## PAYWALL-LOGIKK
| Feature | Gratis | Innlogget | Premium |
|---|---|---|---|
| Spille quiz | ✓ | ✓ | ✓ |
| Nøyaktig plassering | — | ✓ | ✓ |
| Historikk og statistikk | — | — | ✓ |
| Private ligaer | — | — | ✓ |
| Sesong-leaderboard (egen plass) | — | — | ✓ |

Premium: kr 49/mnd. Stripe i **Test Mode** — ikke aktiver live uten beskjed.

---

## FORSIDE — QUIZ-KORT STRUKTUR
Quiz-kortet på forsiden følger dette hierarkiet:
1. Eyebrow: "DENNE UKEN" — `#c9a84c`, `11px`, uppercase
2. Quiz-tittel — `26px`, `Libre Baskerville`, `#ffffff`
3. Tagline — "X deltakere · Kan du slå dem?" — `#c9a84c`, `13px`
4. Topp 3 fra siste quiz (vises alltid når data finnes)
5. "Spill nå"-knapp — sentrert, gul fylt
6. "Toppliste ↗" — diskret under, `#e8e4dd`

Gull-border på kortet: `border: 1px solid rgba(201,168,76,0.2)`
Badges (ÅPEN, LAG) vises IKKE i quiz-kortet på forsiden.

### Hero-statuslinje
Under "Spill ukens quiz"-knappen:
`✓ Gratis · ✓ Innlogget · ★ Premium kr 49/mnd`
- Ikoner (`✓` og `★`) i `#c9a84c`
- Tekst i `#e8e4dd`
- Separatorer (`·`) i `#7a7873`

---

## STRIPE — VIKTIG
- Test Mode: testkort `4242 4242 4242 4242`
- Kun Premium månedlig kr 49 — ukespass er fjernet
- Founders Access: 30 dager gratis trial, ingen kortinfo
- Webhook håndterer: `checkout.completed`, `subscription.deleted`, `subscription.updated`

---

## ADMIN-SIDER — DESIGNREGLER
Alle admin-sider følger designsystemet:
- `app/admin/quizzes/page.tsx` — alle knapper outline, ingen farget bakgrunn
- `app/admin/quizzes/[id]/page.tsx` — ingen Tailwind, inline CSS
- `app/admin/quizzes/[id]/analytics/page.tsx` — ingen fargerike ikoner

Knapper i admin:
- Ingen knapp skal ha farget bakgrunn unntatt primærknappen (gul)
- Slett/destruktive handlinger: outline med `border: #2a2d38`, `color: #e8e4dd`

---

## /BEDRIFT-SIDEN
- Fil: `app/bedrift/page.tsx`
- 'use client'-komponent med useState for accordion
- Har egne CSS-variabler i STYLES-streng (nødvendig — ikke globalt tilgjengelig)
- Accordion-noter: klikk for å ekspandere, én åpen om gangen
- Sammenligningstabell skjules på mobil (under 640px)

---

## HVA SOM IKKE SKAL RØRES UTEN EKSPLISITT BESKJED
- Stripe live-nøkler (er i test-modus)
- RLS-policies i Supabase
- `lib/supabase-admin.ts` (server-only, ikke eksporter til klient)
- `FOUNDERS_ACTIVE`-konstanten i `app/quiz/[id]/page.tsx`
- Autentiseringsflyt og OAuth callback (`app/auth/callback/route.ts`)

---

## KJENTE IKKE-BUGS (ikke fiks disse)
- Scroll-effekt på forsiden: kun synlig i Claude in Chrome-utvidelsen, ikke for ekte brukere
- "Laster profil...": isolert til én spesifikk testbruker, fungerer normalt for alle andre

---

## LANSERINGS-STATUS
Ikke lansert ennå. Stripe er i test-modus. Fokus nå:
1. B2C komplett — TV-show-opplevelse, mellomskjerm, Stripe live
2. B2B selvbetjening
3. Lansering med Founders-kampanje
