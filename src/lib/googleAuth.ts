import supabase from './supabase';

export async function signInWithGoogle(appName = 'EVALU8') {
  // Use Supabase's built-in OAuth - no custom callback URL needed
  // Supabase handles the callback at /auth/v1/callback automatically
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) console.error('[google-auth] signInWithOAuth failed', error.message);
}

export async function handleGoogleRedirect() {
  // Supabase handles the callback automatically via the redirectTo URL
  // This function is kept for compatibility but no longer needed
  const { error } = await supabase.auth.getSession();
  if (error) console.error('[google-auth] getSession failed', error.message);
}
