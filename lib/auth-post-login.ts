import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { welcomeFreeEmail } from '@/lib/email-templates'

// Felles etterbehandling for ALLE e-postbaserte innlogginger.
//
// Kalles fra to steder, som må oppføre seg identisk:
//   - /auth/callback        (PKCE-koden fra Google OAuth)
//   - /api/auth/bekreft     (token_hash fra e-postlenker — magic link, recovery, signup)
//
// Lå tidligere kun inline i /auth/callback. Da den nye token_hash-stien kom til,
// ville en kopi ha betydd to steder å vedlikeholde profilopprettelse og
// velkomstmail — og en ny bruker som kom inn via e-postlenke ville mistet begge
// hvis kopien kom ut av synk. Derfor delt funksjon fra dag én.
export async function ensureProfileForUser(user: User): Promise<void> {
  const now = new Date().toISOString()

  // Google-brukere: seed display_name fra full_name i metadata.
  // E-postlenke-brukere: display_name blir null → AuthListener ber om navn.
  const initialDisplayName =
    (user.user_metadata?.full_name as string | undefined) ?? null

  // Returnerende brukere (≈alle innlogginger): én UPDATE oppdaterer last_seen_at
  // og beholder navnet brukeren selv har valgt — én rundtur.
  // Helt nye brukere: UPDATE treffer 0 rader, så vi INSERT-er og seeder navnet.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ last_seen_at: now })
    .eq('id', user.id)
    .select('id')

  if (updateError) {
    console.error(
      '[auth] profile last_seen update failed — code:', updateError.code,
      'message:', updateError.message,
      'details:', updateError.details
    )
    return
  }

  if (updated && updated.length > 0) {
    console.log('[auth] profile last_seen refreshed for user', user.id)
    return
  }

  // Ingen eksisterende rad → ny bruker. ignoreDuplicates beskytter mot at to
  // samtidige første-innlogginger begge bommer på UPDATE og prøver INSERT.
  const { error: insertError } = await supabaseAdmin
    .from('profiles')
    .upsert(
      { id: user.id, display_name: initialDisplayName, avatar_color: null as string | null, last_seen_at: now },
      { onConflict: 'id', ignoreDuplicates: true }
    )

  if (insertError) {
    console.error(
      '[auth] profile insert failed — code:', insertError.code,
      'message:', insertError.message,
      'details:', insertError.details
    )
    return
  }

  console.log('[auth] profile created for new user', user.id)

  // Velkomstmail til ny gratisbruker — blokkerer aldri innlogging.
  // Kjøres kun én gang: denne grenen nås bare når UPDATE traff 0 rader.
  if (!user.email) return
  const firstName = (initialDisplayName ?? user.email.split('@')[0]).split(' ')[0]
  try {
    await sendEmail({
      to: user.email,
      subject: 'Velkommen til Quizkanonen!',
      html: welcomeFreeEmail(firstName),
      replyTo: 'support@quizkanonen.no',
    })
  } catch (emailErr) {
    console.error('[auth] welcomeFreeEmail feilet:', emailErr)
  }
}

// Kun interne stier er lovlige redirect-mål.
//
// Uten «starter med / men IKKE //»-sjekken er `${origin}${next}` en åpen
// redirect: next=`@evil.com` gir `https://quizkanonen.no@evil.com`, der alt før
// @ tolkes som brukerinfo og nettleseren faktisk går til evil.com. next=`//evil.com`
// gir en protokoll-relativ URL til samme sted.
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/'
  if (!raw.startsWith('/')) return '/'
  if (raw.startsWith('//')) return '/'
  return raw
}
