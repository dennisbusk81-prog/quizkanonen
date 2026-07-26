// Standard HTML-escaping for verdier som limes inn i e-postmaler.
//
// Bakgrunn: malene i lib/email-templates.ts er template-strenger. Alt som
// interpoleres blir markup. Flere av verdiene er brukerstyrte — org-navn,
// avsendernavn, spillernavn — og et navn som «<img src=x onerror=…>» ble
// tidligere sendt ut som ekte HTML fra hei@quizkanonen.no.
//
// Escapes ved SINKET (inne i malfunksjonene), ikke hos hver kaller, slik at en
// framtidig kaller ikke kan glemme det.
//
// Merk: dette er for tekstinnhold og attributtverdier i HTML. URL-er vi bygger
// selv (invitasjonslenker, avmeldingslenker) escapes bevisst ikke — de
// inneholder `&` mellom query-parametere og er allerede validert/signert.

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"']/g, ch => ENTITIES[ch])
}
