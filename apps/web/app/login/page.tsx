import { redirect } from 'next/navigation';
import { LoginForm } from '../../components/login-form';
import { homeForRole } from '../../lib/session';
import { loadSession } from '../../lib/server-session';

export default async function LoginPage() {
  const session = await loadSession();
  if (session.kind === 'authenticated') redirect(homeForRole(session.user.role));
  return (
    <main className="auth-shell">
      <a className="wordmark" href="/">
        <span className="brand-mark" aria-hidden="true">
          fd.
        </span>
        Furniture Delivery
      </a>
      <section className="auth-card">
        <p className="eyebrow">Your workspace</p>
        <h1>Welcome back.</h1>
        <p>Sign in with your personal account.</p>
        <LoginForm />
      </section>
      <a className="muted-link" href="/">
        View service status
      </a>
    </main>
  );
}
