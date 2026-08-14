/** Public client configuration. Replace only with the Project URL and anon/publishable key; never use service_role here. */
export const environment = {
  production: false,
  supabase: {
    url: 'https://your-project.supabase.co',
    anonKey: 'your-anon-or-publishable-key',
  },
} as const;
