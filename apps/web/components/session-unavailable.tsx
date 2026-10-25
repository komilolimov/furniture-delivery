'use client';

import { useRouter } from 'next/navigation';

export function SessionUnavailable() {
  const router = useRouter();
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Connection unavailable</p>
        <h1>We could not check your session.</h1>
        <p>The application service is unavailable. Try again to open your workspace.</p>
        <button className="primary-button" onClick={() => router.refresh()}>
          Retry
        </button>
        <a href="/">View service status</a>
      </section>
    </main>
  );
}
