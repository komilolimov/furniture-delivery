import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import HomePage from '../app/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock('./service-status-navigation', () => ({
  ServiceStatusNavigation: () => {
    throw new Promise(() => undefined);
  },
}));
vi.mock('../lib/health-client', () => ({
  fetchHealth: vi.fn().mockResolvedValue({
    status: 'ok',
    api: 'up',
    database: 'up',
    checkedAt: '2026-10-28T08:00:00.000Z',
  }),
}));

it('renders public health and Back while optional session navigation is still suspended', async () => {
  render(<HomePage />);
  expect(screen.getByRole('heading', { name: 'A connected start.' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  expect(await screen.findByText('All services connected')).toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
});
