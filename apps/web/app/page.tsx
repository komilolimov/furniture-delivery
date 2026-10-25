import { ConnectionStatus } from '../components/connection-status';

export default function HomePage() {
  return (
    <main className="page-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Furniture Delivery home">
          <span className="brand-mark" aria-hidden="true">
            fd.
          </span>
          <span>Furniture Delivery</span>
        </a>
        <a className="check-button" href="/login">
          Sign in
        </a>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Delivery &amp; home assembly</p>
        <h1 id="page-title">A connected start.</h1>
        <p className="intro-copy">
          The foundation for coordinating furniture deliveries and assembly teams. Check the
          connection to your services below.
        </p>
      </section>

      <ConnectionStatus />

      <footer className="site-footer">
        <span>Furniture Delivery</span>
        <span>Identity & teams · M2</span>
      </footer>
    </main>
  );
}
