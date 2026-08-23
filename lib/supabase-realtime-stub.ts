// Erstatter @supabase/realtime-js i bundelen via turbopack.resolveAlias i
// next.config.ts. Appen bruker ikke Realtime noe sted (verifisert 11. august
// 2026), men supabase-js importerer og instansierer RealtimeClient ubetinget
// i konstruktøren — ~204 KB dødvekt i hver sidelasting.
//
// Stubben dekker nøyaktig de kallene supabase-js selv gjør uten at appen ber
// om noe: konstruktøren og setAuth() (fyres ved hver auth-hendelse, også
// INITIAL_SESSION ved sidelast). channel() kaster med vilje: tas Realtime i
// bruk en dag, skal det feile høyt i dev — ikke stille i prod. Riktig fiks er
// da å fjerne aliaset i next.config.ts, ikke å utvide stubben.

export class RealtimeClient {
  constructor(..._args: unknown[]) {}

  setAuth(_token?: string | null): void {}

  channel(name: string): never {
    throw new Error(
      `Supabase Realtime er fjernet fra bundelen (kanal «${name}»). ` +
        'Fjern resolveAlias for @supabase/realtime-js i next.config.ts for å bruke Realtime.'
    )
  }

  getChannels(): unknown[] {
    return []
  }

  removeChannel(_channel: unknown): Promise<string> {
    return Promise.resolve('ok')
  }

  removeAllChannels(): Promise<string[]> {
    return Promise.resolve([])
  }

  disconnect(): void {}
}
