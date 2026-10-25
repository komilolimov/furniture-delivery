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
});
