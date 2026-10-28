import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeNavigation } from './backoffice-navigation';

const navigation = vi.hoisted(() => ({ pathname: '/backoffice' as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

beforeEach(() => {
  navigation.pathname = '/backoffice';
});

describe('Backoffice current section', () => {
  it.each([
    ['/backoffice', 'Dashboard'],
    ['/backoffice/orders', 'Orders'],
    ['/backoffice/orders/fixture', 'Orders'],
    ['/backoffice/orders/new', 'Orders'],
    ['/backoffice/planning', 'Planning'],
    ['/backoffice/planning/orders/order/appointments/visit', 'Planning'],
    ['/backoffice/issues', 'Issues'],
    ['/backoffice/return-requests', 'Return visits'],
    ['/backoffice/return-requests/fixture', 'Return visits'],
    ['/backoffice/crews', 'Teams'],
    ['/backoffice/crews/fixture', 'Teams'],
    ['/backoffice/task-templates', 'Task templates'],
    ['/backoffice/accounts', 'Accounts'],
    ['/', 'Service status'],
  ])('marks only %s as %s', (pathname, label) => {
    navigation.pathname = pathname;
    render(<BackofficeNavigation role="ADMIN" />);
    const nav = screen.getByRole('navigation', { name: 'Backoffice' });
    const selected = within(nav).getByRole('link', { name: label });
    expect(selected).toHaveAttribute('aria-current', 'page');
    expect(selected).toHaveClass('tw:bg-[#edf4e4]', 'tw:border-[#cbdcc2]', 'tw:font-semibold');
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    for (const link of within(nav)
      .getAllByRole('link')
      .filter((link) => link !== selected)) {
      expect(link).not.toHaveAttribute('aria-current');
      expect(link).not.toHaveClass('tw:bg-[#edf4e4]');
    }
  });

  it.each(['/login', '/backoffice/orders-archive', null])(
    'does not guess the current section for %s',
    (pathname) => {
      navigation.pathname = pathname;
      const { container } = render(<BackofficeNavigation role="ADMIN" />);
      expect(container.querySelector('[aria-current]')).toBeNull();
    },
  );

  it('updates the current section after client navigation without marking Dashboard too', () => {
    const view = render(<BackofficeNavigation role="ADMIN" />);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    navigation.pathname = '/backoffice/planning';
    view.rerender(<BackofficeNavigation role="ADMIN" />);
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Planning' })).toHaveAttribute('aria-current', 'page');
    navigation.pathname = '/';
    view.rerender(<BackofficeNavigation role="ADMIN" />);
    expect(screen.getByRole('link', { name: 'Planning' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Service status' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('preserves dispatcher destinations and keeps Accounts administrator-only', () => {
    render(<BackofficeNavigation role="DISPATCHER" />);
    expect(screen.getAllByRole('link')).toHaveLength(8);
    expect(screen.queryByRole('link', { name: 'Accounts' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute(
      'href',
      '/backoffice/orders',
    );
    expect(screen.getByRole('link', { name: 'Service status' })).toHaveAttribute('href', '/');
  });

  it('does not render administrative navigation for crew', () => {
    render(<BackofficeNavigation role="CREW_MEMBER" />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
