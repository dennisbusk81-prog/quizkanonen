// ── Sentry: Node-runtime (API-ruter, Server Components, cron) ────────────────
// Lastes av instrumentation.ts når NEXT_RUNTIME === 'nodejs'.

import * as Sentry from '@sentry/nextjs'
import { collectSecretValues, scrubEvent } from '@/lib/sentry-scrub'
import {
  SENTRY_DSN,
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
  SENTRY_RELEASE,
  TRACES_SAMPLE_RATE,
} from '@/lib/sentry-shared'

// Leses ÉN gang ved oppstart, ikke per event: process.env endrer seg ikke i en
// kjørende serverless-instans, og å bygge lista på nytt for hver feil ville
// vært arbeid i akkurat den stien som allerede går dårlig.
const SECRETS = collectSecretValues(process.env)

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  release: SENTRY_RELEASE,

  tracesSampleRate: TRACES_SAMPLE_RATE,

  // Eksplisitt AV: med den PÅ legger Sentry ved IP-adresse, cookies og
  // request-body på server-events. Alle tre kan bære Bearer-token, e-post eller
  // hele sesjonen i denne kodebasen.
  sendDefaultPii: false,

  beforeSend: (event) => scrubEvent(event, SECRETS),
  beforeSendTransaction: (event) => scrubEvent(event, SECRETS),
})
