import type { SupabaseClient } from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';

export class SupabaseClientService {
  readonly configured: boolean;
  private clientPromise?: Promise<SupabaseClient>;

  constructor() {
    this.configured = !environment.supabase.url.includes('your-project') &&
      !environment.supabase.anonKey.includes('your-anon-or-publishable-key');
  }

  getClient(): Promise<SupabaseClient> {
    this.clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(environment.supabase.url, environment.supabase.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }),
    );
    return this.clientPromise;
  }

  requireConfigured(): void {
    if (!this.configured) {
      throw new Error('Configura la URL y la clave pública de Supabase en src/environments/environment.ts.');
    }
  }
}

export const supabaseClientService = new SupabaseClientService();
