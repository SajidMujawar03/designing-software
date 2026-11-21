import { useState, type FormEvent } from 'react';
import { signIn, signUp, useSession } from '../cloud/session';

export function SignIn() {
  const google = useSession((s) => s.google);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(new URLSearchParams(location.search).get('error') === 'google' ? 'Google sign-in failed. Try again.' : null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') await signUp(name, email, password);
      else await signIn(email, password);
      // Back to where the person was going (e.g. a shared file link).
      if (location.pathname.startsWith('/signin')) location.assign('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">◆</div>
        <h1>{mode === 'signup' ? 'Create your account' : 'Sign in'}</h1>
        {google && (
          <>
            <a className="auth-google" href="/api/auth/google">
              Continue with Google
            </a>
            <div className="auth-or">or</div>
          </>
        )}
        {mode === 'signup' && (
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </label>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            required
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
        <div className="auth-switch">
          {mode === 'signup' ? 'Already have an account?' : 'New here?'}{' '}
          <button type="button" onClick={() => (setMode(mode === 'signup' ? 'signin' : 'signup'), setError(null))}>
            {mode === 'signup' ? 'Sign in' : 'Create an account'}
          </button>
        </div>
        <a className="auth-local" href="/local">
          Continue without an account (files stay in this browser)
        </a>
      </form>
    </div>
  );
}
