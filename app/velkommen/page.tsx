import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import WelcomeScreen from '@/components/WelcomeScreen'
import { welcomeOnboardingEnabled } from '@/lib/welcome-onboarding'

// Serverkomponent, og det er hele poenget med filen: den leser av/på-bryteren
// FØR noe som helst rendres.
//
// Bryteren er WELCOME_ONBOARDING_ENABLED. Mangler variabelen, er funksjonen
// inert i BEGGE ender — auth-rutene sender aldri noen hit, og skulle en gammel
// lenke likevel treffe ruten, går brukeren rett til forsiden i stedet for å
// møte en halvdød side. Samme inert-mønster som NEXT_PUBLIC_SENTRY_DSN og
// KV_REST_API_URL: fraværet av variabelen ER funksjonsbryteren.
//
// force-dynamic er ikke pynt. Uten den kan Next prerendre ruten ved bygg og
// bake inn verdien bryteren hadde DA — og da ville en endring i Vercel ikke
// kunne slå gjennom på siden i det hele tatt.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Velkommen — Quizkanonen',
  // Siden gir ingen mening uten en fersk sesjon, og skal ikke ligge i søk.
  robots: { index: false, follow: false },
}

export default function VelkommenPage() {
  if (!welcomeOnboardingEnabled(process.env.WELCOME_ONBOARDING_ENABLED)) {
    redirect('/')
  }

  return <WelcomeScreen />
}
