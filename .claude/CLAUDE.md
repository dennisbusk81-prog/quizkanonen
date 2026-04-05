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

## STRIPE — VIKTIG
- Test Mode: testkort `4242 4242 4242 4242`
- Kun Premium månedlig kr 49 — ukespass er fjernet
- Founders Access: 30 dager gratis trial, ingen kortinfo
- Webhook håndterer: `checkout.completed`, `subscription.deleted`, `subscription.updated`

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
1. Sesong-leaderboard `/toppliste` (ferdigstilles)
2. TV-show-opplevelse (5 animasjonsøyeblikk i spillskjermen)
3. Stripe live-modus + Supabase Pro
