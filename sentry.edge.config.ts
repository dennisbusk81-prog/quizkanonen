// ── Sentry: Edge-runtime (middleware.ts) ─────────────────────────────────────
// Lastes av instrumentation.ts når NEXT_RUNTIME === 'edge'. Gjelder i praksis
// Supabase-SSR-middlewaren, som kjører på hver sidevisning — derfor er det den
// ene stien der en stille feil rammer absolutt alle.

import * as Sentry from '@sentry/nextjs'
import { collectSecretValues, scrubEvent } from '@/lib/sentry-scrub'
import {
  SENTRY_DSN,
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
  SENTRY_RELEASE,
  TRACES_SAMPLE_RATE,
} from '@/lib/sentry-shared'

const SECRETS = collectSecretValues(process.env)

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  release: SENTRY_RELEASE,

  tracesSampleRate: TRACES_SAMPLE_RATE,
  sendDefaultPii: false,

  beforeSend: (event) => scrubEvent(event, SECRETS),
  beforeSendTransaction: (event) => scrubEvent(event, SECRETS),
})
