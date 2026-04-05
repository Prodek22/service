import { FormEvent, useState } from 'react';

type LoginPageProps = {
  loading?: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
};

export const LoginPage = ({ loading = false, onLogin }: LoginPageProps) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      await onLogin(username, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login eșuat');
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-stage">
        <h2 className="login-spotlight-title" data-text="Paradise Auto Repair">
          Paradise Auto Repair
        </h2>

        <form className="auth-card" onSubmit={submit}>
          <h1>Service Admin Login</h1>
          <p>Accesul la panel este disponibil doar utilizatorilor autorizați.</p>

          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          <p className="auth-help">Pentru înregistrare contactați administratorul service-ului.</p>

          {error ? <p className="error">{error}</p> : null}

          <div className="auth-submit-wrap">
            <button type="submit" className="login-3d-btn" disabled={loading}>
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span className="login-3d-btn-label">{loading ? 'Se autentifică...' : 'Login'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
