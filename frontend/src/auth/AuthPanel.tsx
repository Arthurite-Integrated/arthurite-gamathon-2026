import { useState, type FormEvent } from 'react';
import { confirmSignUp, signIn, signUp } from 'aws-amplify/auth';
import { PasswordField } from './PasswordField';

type Mode = 'signIn' | 'signUp' | 'confirm';

interface Props {
  onSignedIn: () => void;
}

export function AuthPanel({ onSignedIn }: Props) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signUp') {
        await signUp({ username: email, password, options: { userAttributes: { email } } });
        setMode('confirm');
      } else if (mode === 'confirm') {
        await confirmSignUp({ username: email, confirmationCode: code });
        await signIn({ username: email, password });
        onSignedIn();
      } else {
        const result = await signIn({ username: email, password });
        if (result.isSignedIn) onSignedIn();
        else setError(`Additional step required: ${result.nextStep.signInStep}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const title = { signIn: 'Sign in', signUp: 'Create account', confirm: 'Check your email' }[mode];

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>{title}</h2>

      {mode === 'confirm' ? (
        <>
          <p className="muted">We sent a verification code to {email}.</p>
          <label>
            Verification code
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" required />
          </label>
        </>
      ) : (
        <>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          {/* key: switching between sign in and sign up hides the password again */}
          <PasswordField
            key={mode}
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            minLength={8}
            required
          />
        </>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      <button type="submit" disabled={busy}>
        {busy ? 'Please wait…' : title}
      </button>

      {mode !== 'confirm' && (
        <button
          type="button"
          className="link"
          onClick={() => {
            setError(null);
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
          }}
        >
          {mode === 'signIn' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
      )}
    </form>
  );
}
