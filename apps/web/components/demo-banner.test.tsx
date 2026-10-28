import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RootLayout from '../app/layout';
describe('root layout presentation and environment privacy', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('renders the workspace without a banner or private run state in the isolated demo', () => {
    vi.stubEnv('FD_DEMO_RUN', 'fixture-run-private-marker');
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Workspace</p>
      </RootLayout>,
    );
    expect(html).toContain('Workspace');
    expect(html).not.toContain('DEMO — SYNTHETIC DATA');
    expect(html).not.toContain('demo-banner');
    expect(html).not.toContain('fixture-run-private-marker');
  });
  it('keeps the ordinary application unlabelled', () => {
    vi.stubEnv('FD_DEMO_RUN', '');
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Workspace</p>
      </RootLayout>,
    );
    expect(html).toContain('Workspace');
    expect(html).not.toContain('DEMO — SYNTHETIC DATA');
  });
});
