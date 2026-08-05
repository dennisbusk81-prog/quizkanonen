import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
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
