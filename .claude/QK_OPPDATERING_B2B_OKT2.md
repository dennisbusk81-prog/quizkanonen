# Quizkanonen — Oppdatering etter B2B-økt 2 (6. april 2026)

---

## HVA SOM BLE FIKSET OG BYGGET

### FLYT OG LASTING
```
OK  /bedrift/success henger ikke lenger på "Laster..." — timeout på 5 sek,
      viser alltid noe nyttig selv om Stripe-webhook ikke har landet
OK  /org/[id]/admin laster uten F5 — onAuthStateChange-lytter fikset
OK  Navigasjon til adminpanel fra /bedrift/success er smooth
```

### STRIPE OG BETALING
```
OK  stripe_period_end lagres alltid etter betaling:
      1. Forsøker stripe.subscriptions.retrieve() med logging
      2. Fallback fra session-objektet hvis retrieve feiler
      3. Siste-utvei: 30 dager frem hvis begge feiler
      Nye kjøp viser alltid dato i "Premium utløper"-feltet
!!  Gamle testorgs (opprettet før fix) viser fortsatt strek — ikke en bug
```

### ORG-ADMIN PANELET
```
OK  Toggles — gull (#c9a84c) når PÅ, mørk (#2a2d38) når AV. Tydelig visuell forskjell
OK  Innloggings-redirect: uinnlogget bruker sendes til /login?next=/org/[id]/admin
OK  "Premium utløper" viser norsk dato for nye kjøp (f.eks. "6. mai 2026")
      NB: "Mai" vises med stor M — cosmetic bug, lav prioritet
```

### NAVIGASJON OG USERMENU
```
OK  Nav-struktur basert på brukertype:
      Ikke innlogget:        For bedrifter · Logg inn · Spill ukens quiz →
      Innlogget, ikke admin: For bedrifter · UserMenu
      Innlogget, org-admin:  Bedriftspanel · For bedrifter · UserMenu

OK  "Bedriftspanel" i UserMenu — vises kun for org-admins
      Hentes via /api/org/my-admin-orgs (service role, omgår RLS)
      Én linje per org hvis admin i flere

OK  "For bedrifter" i nav lenker alltid til /bedrift
OK  "Bedriftspanel" i nav lenker til /org/[slug]/admin
```

### INVITASJONSFLYT
```
OK  /bli-med/[token] — viser bedriftsnavn, beskjed om Premium inkludert
OK  Logg inn med Google → sjekker om bruker allerede er medlem
OK  Korrekt feilmelding "Du er allerede medlem av en organisasjon"
!!  Ikke fullstendig end-to-end testet med en helt ny bruker (krever annen Google-konto)
      Logikken er på plass — ny bruker skal havne i org og få Premium
```

---

## TEKNISK GJELD LAGT TIL

```
MEDIUM:
-  "Mai" vises med stor M i "Premium utløper"-feltet (norsk datoformat-bug)
-  Invitasjonsflyt ikke testet end-to-end med ny bruker
```

---

## OPPDATER LANSERINGS-SJEKKLISTE (QK_4)

### B2B — oppdater status:
```
[✓] Bedrift oppretter egen organisasjon (selvbetjening — /bedrift/registrer)
[✓] Dataisolasjon — organization_invites + RLS på plass
[✓] Org-admin grensesnitt — toggles, invitasjonslenker, medlemsoversikt
[◐] Bulk-invitasjon av ansatte (token-flyt fungerer, ikke testet end-to-end)
[◐] Stripe for organisasjoner (checkout fungerer, ikke live)
[✓] B2B-landingsside (/bedrift)
[✓] Inngang til bedriftspanel fra nav og UserMenu
```

---

## FREMTIDIGE B2B-FEATURES (legg til i backlog)

```
MEDIUM PRIORITET:
-  Org-egne quiz-tidspunkter — bedrift setter egne opens_at/closes_at
   Salgsargument: "Sett quizen til å stenge kl. 15:00, kåre vinneren før helgen"
   Krever: quiz knyttes til org med egne tidspunkter, org-admin setter dette selv

LAV PRIORITET:
-  Org-admin dashboard med medlemshåndtering (fjerne/legge til medlemmer)
-  Stripe-portal for organisasjoner (endre plan, se fakturaer)
```

---

## NESTE STEG (prioritert)

1. **Test invitasjonsflyt end-to-end** med en annen Google-konto
2. **Stripe live-modus** — bytt nøkler i Vercel, nytt price ID
3. ~~**Supabase Pro**~~ — **AKTIVERT 14. juni 2026**
4. **B2C komplett** — TV-show-opplevelse, mellomresultat, forklaringstekst per spørsmål

---

## MERK TIL NESTE ØKET

- Stripe fortsatt i **Test Mode**
- Testorganisasjoner ryddet — kun "Elkjøp-test" (slug: y7a1d0ef9) gjenstår
- Nye filer/endringer denne økten:
  - `app/api/org/my-admin-orgs/route.ts` (ny)
  - `app/api/stripe/webhook/route.ts` (stripe_period_end fix)
  - `app/bedrift/success/page.tsx` (timeout-fix)
  - `app/org/[slug]/admin/page.tsx` (loading + redirect)
  - `components/UserMenu.tsx` (adminOrgs via API)
  - `components/NavAuth.tsx` (tre-element nav-struktur)
