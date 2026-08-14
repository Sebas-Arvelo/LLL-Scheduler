import { authErrorMessage } from './auth.service';

describe('Supabase authentication errors', () => {
  it('translates common authentication and network failures', () => {
    expect(authErrorMessage(new Error('Invalid login credentials'))).toBe('Email o contraseña incorrectos.');
    expect(authErrorMessage(new Error('Email not confirmed'))).toContain('Confirma tu email');
    expect(authErrorMessage(new Error('User already registered'))).toContain('Ya existe una cuenta');
    expect(authErrorMessage(new Error('Failed to fetch'))).toContain('conectar con Supabase');
  });

  it('does not expose unknown provider messages', () => {
    expect(authErrorMessage(new Error('internal provider detail'))).toBe(
      'No se pudo completar la autenticación. Inténtalo nuevamente.',
    );
  });
});
