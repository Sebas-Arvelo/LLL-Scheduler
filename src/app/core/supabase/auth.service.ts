import type { AuthChangeEvent, Session, Subscription } from '@supabase/supabase-js';

import { supabaseClientService } from './supabase-client.service';

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export interface AuthGateway {
  initialize(): Promise<AuthenticatedUser | undefined>;
  onAuthStateChange(listener: (user: AuthenticatedUser | undefined) => void): () => void;
  signIn(email: string, password: string): Promise<AuthenticatedUser>;
  signUp(email: string, password: string): Promise<{ user?: AuthenticatedUser; confirmationRequired: boolean }>;
  signOut(): Promise<void>;
}

function toUser(session: Session | null): AuthenticatedUser | undefined {
  return session?.user ? { id: session.user.id, ...(session.user.email ? { email: session.user.email } : {}) } : undefined;
}

export function authErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('invalid login credentials')) return 'Email o contraseña incorrectos.';
  if (message.includes('email not confirmed')) return 'Confirma tu email antes de iniciar sesión.';
  if (message.includes('already registered') || message.includes('user already registered')) return 'Ya existe una cuenta con ese email.';
  if (message.includes('failed to fetch') || message.includes('network')) return 'No se pudo conectar con Supabase. Revisa tu conexión.';
  return 'No se pudo completar la autenticación. Inténtalo nuevamente.';
}

export class AuthService implements AuthGateway {
  async initialize(): Promise<AuthenticatedUser | undefined> {
    if (!supabaseClientService.configured) return undefined;
    const client = await supabaseClientService.getClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error(authErrorMessage(error));
    return toUser(data.session);
  }

  onAuthStateChange(listener: (user: AuthenticatedUser | undefined) => void): () => void {
    let active = true;
    let subscription: Subscription | undefined;
    if (supabaseClientService.configured) {
      void supabaseClientService.getClient().then((client) => {
        if (!active) return;
        const { data } = client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
          listener(toUser(session));
        });
        subscription = data.subscription;
      });
    }
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }

  async signIn(email: string, password: string): Promise<AuthenticatedUser> {
    supabaseClientService.requireConfigured();
    const client = await supabaseClientService.getClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(authErrorMessage(error));
    const user = toUser(data.session);
    if (!user) throw new Error('No se pudo iniciar la sesión.');
    return user;
  }

  async signUp(email: string, password: string): Promise<{ user?: AuthenticatedUser; confirmationRequired: boolean }> {
    supabaseClientService.requireConfigured();
    const client = await supabaseClientService.getClient();
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw new Error(authErrorMessage(error));
    const user = data.user ? { id: data.user.id, ...(data.user.email ? { email: data.user.email } : {}) } : undefined;
    return { ...(user ? { user } : {}), confirmationRequired: !data.session };
  }

  async signOut(): Promise<void> {
    supabaseClientService.requireConfigured();
    const client = await supabaseClientService.getClient();
    const { error } = await client.auth.signOut();
    if (error) throw new Error(authErrorMessage(error));
  }
}
