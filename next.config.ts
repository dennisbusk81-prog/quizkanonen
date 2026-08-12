import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Founders-programmet ble avviklet 12. august 2026 (trialene kanselleres
  // 14.–15. august). /founders inviterte aktivt med «FOUNDERS-TILBUD» og
  // «N av 250 plasser igjen», og var eneste kaller av
  // /api/stripe/founders-activate — som dermed ikke lenger er nåbar fra UI.
  // API-rutene står urørt med vilje: /api/founders/count leses fortsatt av
  // admin-panelet, og org-varianten (/api/stripe/org-founders-activate, brukt
  // av /bedrift/registrer) er en annen flyt og upåvirket.
  //
  // Redirecten ligger HER og ikke som permanentRedirect() i en page-komponent,
  // og det er et empirisk begrunnet valg: `app/loading.tsx` ligger i ROTEN av
  // app-katalogen og gir dermed hver rute en Suspense-grense. Skallet flushes
  // før page-komponenten er ferdig, så headerne er allerede sendt når
  // redirecten kastes — Next kan da ikke svare 3xx og degraderer til
  // `<meta http-equiv="refresh" content="0;url=/premium">`. Målt i BEGGE
  // moduser (`next dev` og produksjonsbygg + `next start`): 200 OK med
  // meta-refresh, og `curl -L` ble stående på /founders. Det gir et blaff av
  // skjelett-UI og ingen permanent-redirect-beskjed til crawlere eller til
  // lenker delt i e-post og Facebook-gruppa.
  //
  // Merk at dette gjelder ALLE server-redirects i appen, ikke bare denne:
  // `/founders/success` → `/login` for uinnloggede har samme svakhet.
  //
  // Her skjer redirecten i rutingslaget, før noe rendres — ekte 308.
  // `permanent: true` = 308. Kilden matcher kun /founders eksakt, så
  // /founders/success er upåvirket.
  async redirects() {
    return [
      { source: '/founders', destination: '/premium', permanent: true },
    ]
  },
};

// Sentry pakker inn konfigurasjonen for å laste opp source maps ved build, slik
// at stack traces i dashbordet peker på ekte filnavn og linjer i stedet for
// minifisert bundel-grøt.
//
// org/project/authToken leses fra miljøet — ingen slug eller nøkkel hardkodes
// her. Mangler SENTRY_AUTH_TOKEN (typisk lokalt), hopper plugin-en over
// opplastingen og bygget går som før; feilrapportering virker uansett, man får
// bare uleselige stack traces.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Bare støy i Vercel-byggloggen når alt går bra.
  silent: !process.env.CI,

  // Source maps slettes fra .next etter opplasting. Uten dette ville de blitt
  // liggende og servert offentlig, og hele serverkoden vår vært lesbar for hvem
  // som helst som åpner devtools.
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Utvider source map-opplastingen til klient-chunks Next legger utenfor
  // standardmappa — ellers mangler nettopp spillskjermens stack traces.
  widenClientFileUpload: true,

  // `disableLogger` er bevisst IKKE satt: den er deprekert i SDK-en, og
  // erstatteren (webpack.treeshake.removeDebugLogging) gjelder kun webpack —
  // Next 16 bygger med Turbopack, så begge ville vært et no-op her.

  // Ingen anonym byggtelemetri til Sentry.
  telemetry: false,
});
