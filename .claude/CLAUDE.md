# Quizkanonen — Claude Code kontekst
Sist oppdatert: 15. juni 2026

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
- Aldri to gule elementer (knapp ELLER tekstlenke) på samme skjerm
- Sekundær: outline, transparent bakgrunn
- Founders-knapp: hvit outline (`border: 1px solid #e8e4dd`, `color: #e8e4dd`) — ikke gull

### Border-radius
- Kort: `16px`
- Knapper: `10px`

### Luft og padding
- Kort padding: minimum `24px 20px`, gjerne `28px`
- Mer luft er alltid bedre enn tettere

### Lenker
- Lenker som ikke er primærhandlinger: `#e8e4dd` — aldri `#7a7873`
- Unntak: hint-tekst og metadata som ikke krever klikk kan være `#7a7873`

### Regler
- Ingen Tailwind
- Ingen emoji i UI — SVG der nødvendig (unntak: medalje-emoji på leaderboard)
- Ingen hardkodede farger utenfor systemet ovenfor

---

## ARKITEKTUR OG MØNSTRE

### Auth
- Supabase auth med Google OAuth + magic link
- `lib/auth.ts` for signIn, signOut, getSession, getProfile
- `lib/supabase-admin.ts` er server-only (service role)
- Admin-auth: passord i `ADMIN_PASSWORD` env-var, sesjon i localStorage 8 timer

### Navnepolicy
- display_name er påkrevd for innloggede brukere
- Regex: `/^[\p{L}\s\-']{2,40}$/u`
- Google-navn settes automatisk som default ved OAuth (AuthListener.tsx)
- NameRequiredModal.tsx blokkerer ved manglende/ugyldig navn
- Validering håndheves i `/api/profile/upsert/route.ts`

### Lag og sesong
- leader_display_name (TEXT, nullable) på attempts-tabellen
- Laglederens user_id registreres på season_scores
- Hint-tekst på quiz-startsiden: "Sesong-poeng registreres på deg som er innlogget."

### Database-tabeller (eksisterende)
`quizzes`, `questions`, `attempts` (+ leader_display_name),
`attempt_answers`, `played_log`, `access_codes`, `admin_users`,
`site_settings`, `profiles`, `organizations`, `organization_members`,
`organization_invites`, `leagues`, `league_members`, `ranking_snapshots`,
`season_scores`, `admin_actions`, `excluded_members`

### Sesong-leaderboard-arkitektur
- `season_scores`: scope_type IN ('global', 'league', 'organization')
- Global: scope_type='global', scope_id=NULL
- Poeng skrives av `/api/cron/award-season-points` hvert 5. minutt
- `SeasonLeaderboard.tsx` er delt komponent — brukes av /toppliste, /liga/[slug], /org/[slug]
- Forsiden viser månedens globale topp 3 fra season_scores (ikke fra attempts)

### Miljøvariabler (ligger i Vercel — ikke hardkod)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `NEXT_PUBLIC_SITE_URL`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`,
`RESEND_API_KEY`, `ANTHROPIC_API_KEY`,
`STRIPE_PRICE_FOUNDERS`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
`STRIPE_ORG_STARTER_PRICE_ID`, `STRIPE_ORG_STANDARD_PRICE_ID`, `STRIPE_ORG_PRO_PRICE_ID`

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

## FORSIDE — STRUKTUR (app/page.tsx)
Rekkefølge ovenfra:
1. Nav (NavAuth.tsx) — "Toppliste" synlig på desktop, skjult på mobil
2. Hero — tittel, undertittel, gul knapp, statuslinje
3. Sitat-linje — kursiv, #7a7873
4. Fakta-ikoner — tre SVG (kalender, person, stjerne)
5. Divider
6. Quiz-kort — eyebrow, tittel, tagline, månedlig leaderboard, outline-knapp
7. Lenker under kortet — sesong-toppliste + alle quizer
8. Accordion — tre items
9. Bedrifts-seksjon — #1e1a0e bakgrunn, gull-border
10. Founders-seksjon — uendret, hvit outline-knapp

Månedlig leaderboard i quiz-kortet:
- Henter fra season_scores WHERE scope_type='global' AND scope_id IS NULL
- Filtrert på inneværende kalender-måned (closes_at)
- Aggregeres i JS på serveren, sortert DESC på total_points
- Vises kun hvis minst 1 rad finnes med gyldig display_name

---

## STRIPE — VIKTIG
- Test Mode: testkort `4242 4242 4242 4242`
- Kun Premium månedlig kr 49 — ukespass er fjernet
- Founders Access: 30 dager gratis trial, ingen kortinfo
- Founders-knapp: hvit outline — ikke gull (to-gule-regel)
- Webhook håndterer: `checkout.completed`, `subscription.deleted`, `subscription.updated`

---

## HVA SOM IKKE SKAL RØRES UTEN EKSPLISITT BESKJED
- Stripe live-nøkler (er i test-modus)
- RLS-policies i Supabase
- `lib/supabase-admin.ts` (server-only, ikke eksporter til klient)
- `FOUNDERS_ACTIVE`-konstanten i `app/quiz/[id]/page.tsx`
- Autentiseringsflyt og OAuth callback (`app/auth/callback/route.ts`)
- `ranking_snapshots`-tabellen (brukes av mellomskjerm-cachen)

---

## KJENTE IKKE-BUGS (ikke fiks disse)
- Scroll-effekt på forsiden: kun synlig i Claude in Chrome-utvidelsen
- "Laster profil...": isolert til én spesifikk testbruker

## KJENTE BUGS (lav prioritet)
- "Spill nå"-knappen i quiz-kortet på forsiden vises gul fylt istedenfor outline
  Koden er riktig (inline style, transparent bg) men noe overstyrer den
  Tas i dedikert økt — ikke kritisk

---

## LANSERINGS-STATUS
Ikke lansert ennå. Stripe er i test-modus.

Neste prioriterte steg:
1. Forklaringstekst per spørsmål (admin-felt)
2. E-post ved Stripe-hendelser
3. Mobil-test på ekte enheter
4. Stripe live-modus (krever ENK — Dennis oppretter ENK)
5. ~~Supabase Pro~~ — AKTIVERT 14. juni 2026
