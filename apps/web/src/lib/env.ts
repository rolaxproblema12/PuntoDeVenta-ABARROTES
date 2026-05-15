export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  apiUrl: (import.meta.env.VITE_API_URL as string) ?? 'http://127.0.0.1:3000/api/v1',
};
