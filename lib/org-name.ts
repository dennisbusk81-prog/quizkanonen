// Validering av organisasjonsnavn ved OPPRETTELSE.
//
// Navnet skrives inn i organizations.name fra to ruter (org-checkout og
// org-founders-activate) og havner senere i e-poster til både medlemmer og
// admin. Escaping i malene hindrer at markup tolkes; denne validasjonen hindrer
// at slikt innhold kommer inn i databasen i det hele tatt — defense in depth.
//
// Tegnsettet er bevisst romslig nok for ekte nordiske firmanavn
// («Elkjøp Nordic», «Müller & Sønn AS», «Bok/Papir (Oslo)») men utelukker
// vinkelparenteser, anførselstegn, kontrolltegn og annet markup-materiale.

export const ORG_NAME_MIN = 2
export const ORG_NAME_MAX = 60

// Bokstaver (alle språk), tall, mellomrom og vanlig firmanavn-tegnsetting.
// Tankestrek (– —) og kolon er med fordi de forekommer i ekte firmanavn; de er
// ren tekst og har ingen betydning i HTML.
const ORG_NAME_RE = /^[\p{L}\p{N} .,:'’\-–—&()/+]+$/u

export type OrgNameResult =
  | { ok: true; value: string }
  | { ok: false; error: string }

export function validateOrgName(raw: unknown): OrgNameResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Mangler organisasjonsnavn' }
  }

  // Kollaps alt whitespace (inkl. linjeskift og tab) til enkle mellomrom før
  // lengdemåling, slik at «A\n\n\n\nB» ikke teller som et langt navn.
  const value = raw.replace(/\s+/g, ' ').trim()

  if (value.length < ORG_NAME_MIN) {
    return { ok: false, error: `Organisasjonsnavnet må være minst ${ORG_NAME_MIN} tegn` }
  }
  if (value.length > ORG_NAME_MAX) {
    return { ok: false, error: `Organisasjonsnavnet kan maks være ${ORG_NAME_MAX} tegn` }
  }
  if (!ORG_NAME_RE.test(value)) {
    return {
      ok: false,
      error: 'Organisasjonsnavnet kan bare inneholde bokstaver, tall, mellomrom og tegnene . , \' - & ( ) / +',
    }
  }

  return { ok: true, value }
}
