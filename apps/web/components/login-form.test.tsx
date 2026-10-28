import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { LoginForm } from './login-form';

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
const user = {
  id: 'user-1',
  username: 'worker',
  displayName: 'Worker',
  role: 'CREW_MEMBER',
  active: true,
  crewIds: [],
};

beforeEach(() => {
  apiMock.mockReset();
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
});

function submitLogin() {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'worker' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-only-password' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
}

describe('LoginForm', () => {
  it('submits personal credentials and opens the staff workspace', async () => {
    apiMock.mockResolvedValue({ user });
    render(<LoginForm />);
    submitLogin();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/crew'));
    expect(apiMock).toHaveBeenCalledWith('/auth/login', {
      method: 'POST',
      body: { username: 'worker', password: 'test-only-password' },
    });
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
  it('keeps incorrect sign-in on screen with a retryable error', async () => {
    apiMock.mockRejectedValue(new ApiError(401, 'Invalid sign-in details.'));
    render(<LoginForm />);
    submitLogin();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid sign-in details.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
  it('disables submission while sign-in is pending', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    render(<LoginForm />);
    submitLogin();
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  });
  it('does not open a workspace for an invalid or disabled session response', async () => {
    apiMock.mockResolvedValue({ user: { ...user, active: false } });
    render(<LoginForm />);
    submitLogin();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
  it('shows and hides the same password field without changing its value or submitting', () => {
    render(<LoginForm />);
    const password = screen.getByLabelText('Password');
    fireEvent.change(password, { target: { value: ' synthetic test phrase ' } });
    const show = screen.getByRole('button', { name: 'Show password' });
    expect(show).toHaveAttribute('type', 'button');
    expect(show).toHaveAttribute('aria-controls', password.id);
    expect(show).toHaveAttribute('aria-pressed', 'false');
    expect(password).toHaveAttribute('type', 'password');
    fireEvent.click(show);
    expect(screen.getByLabelText('Password')).toBe(password);
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue(' synthetic test phrase ');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(hide);
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue(' synthetic test phrase ');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('masks a revealed password on submission and retains it after rejected sign-in', async () => {
    apiMock.mockRejectedValue(new ApiError(401, 'Invalid sign-in details.'));
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    submitLogin();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled();
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Password')).toHaveValue('test-only-password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeEnabled();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/auth/login', {
      method: 'POST',
      body: { username: 'worker', password: 'test-only-password' },
    });
  });
});
