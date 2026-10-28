import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceBackButton } from './service-back-button';

const navigation = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

beforeEach(() => {
  navigation.back.mockReset();
  navigation.push.mockReset();
});

describe('Service status back navigation', () => {
  it('returns through browser history when a previous entry exists', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(2);
    render(<ServiceBackButton />);
    const button = screen.getByRole('button', { name: 'Back' });
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    expect(navigation.back).toHaveBeenCalledTimes(1);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('opens sign-in as a useful fallback for a direct first-page visit', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    render(<ServiceBackButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(navigation.push).toHaveBeenCalledWith('/login');
    expect(navigation.back).not.toHaveBeenCalled();
  });
});
