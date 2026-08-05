// ── Sentry: nettleseren ──────────────────────────────────────────────────────
// Next 16 laster denne fila automatisk i klienten (avløseren for det som før
// het sentry.client.config.ts). Kjører før appens egen kode, slik at feil under
// oppstart også fanges.

import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/sentry-scrub'
import {
  SENTRY_DSN,
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
  SENTRY_RELEASE,
  TRACES_SAMPLE_RATE,
} from '@/lib/sentry-shared'

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  release: SENTRY_RELEASE,

  tracesSampleRate: TRACES_SAMPLE_RATE,

  // Eksplisitt AV. Er false som standard i SDK-en, men står her fordi det er en
  // beslutning og ikke en tilfeldighet: med den PÅ ville Sentry lagt ved
  // IP-adresse og innlogget brukers e-post på hvert eneste event.
  sendDefaultPii: false,

  // Session Replay er bevisst IKKE slått på. Den ville filmet skjermen til
  // spillere som er midt i en quiz — navn, e-post i skjemafelt, hele
  // innloggingsflyten — og lagret det hos en tredjepart. Skal det vurderes
  // senere, må det gjøres som en egen beslutning med maskering, ikke som en
  // bieffekt av feilovervåkning.

  // Ingen hemmeligheter er tilgjengelige i klienten (kun NEXT_PUBLIC_*), så
  // andre argument er tomt her — mønstervakten i scrubEvent gjelder likevel.
  beforeSend: (event) => scrubEvent(event),

  // Bevisst KORT liste. Kun støy uten handlingsrom: ResizeObserver-varselet
  // som alle nettsteder får og ingen bruker merker, og rejections uten noen
  // feil å lese.
  //
  // Nettverksfeil ("Failed to fetch") og AbortError er med VILJE ikke filtrert
  // bort, selv om de er den vanligste kilden til støy i klient-Sentry. Grunnen
  // er at de er nettopp det vi mangler i dag: en Supabase-utetid ser ut som en
  // bunke "Failed to fetch", og timeout-vaktene i lib/with-timeout.ts (goToNext
  // og finishQuiz) avbryter via AbortController — det er selve signalet om at
  // en spiller sto fast ved målstreken. Filtrer heller ned senere, når vi vet
  // hva volumet faktisk er, enn å være blind fra dag én.
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error promise rejection captured',
  ],
})

// Gjør at Next kan måle og rapportere navigasjoner mellom sider.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
