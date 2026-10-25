import type { HealthResponse } from '@furniture-delivery/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchHealth } from '../lib/health-client';
import { ConnectionStatus } from './connection-status';

vi.mock('../lib/health-client', () => ({ fetchHealth: vi.fn() }));
const fetchHealthMock = vi.mocked(fetchHealth);
const healthy: HealthResponse = {
  status: 'ok',
  api: 'up',
  database: 'up',
  checkedAt: '2026-10-25T12:00:00.000Z',
};

beforeEach(() => {
  fetchHealthMock.mockReset();
});

describe('ConnectionStatus', () => {
  it('shows loading while a request is pending', () => {
    fetchHealthMock.mockReturnValue(new Promise(() => undefined));
    render(<ConnectionStatus />);
    expect(screen.getByText('Checking your connection')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    expect(screen.queryByText('All services connected')).not.toBeInTheDocument();
  });

  it('shows successful API and database checks from the response', async () => {
    fetchHealthMock.mockResolvedValue(healthy);
    render(<ConnectionStatus />);
    expect(await screen.findByText('All services connected')).toBeInTheDocument();
    expect(screen.getByText('Reachable')).toBeInTheDocument();
    expect(screen.getByRole('time')).toHaveAttribute('datetime', healthy.checkedAt);
  });

  it('shows API reachable and database unavailable for HTTP 503 data', async () => {
    fetchHealthMock.mockResolvedValue({ ...healthy, status: 'error', database: 'down' });
    render(<ConnectionStatus />);
    expect(await screen.findByText('Connection needs attention')).toBeInTheDocument();
    expect(screen.getByText('Reachable')).toBeInTheDocument();
    const databaseRow = screen.getByRole('heading', { name: 'Database' }).closest('li');
    expect(databaseRow).not.toBeNull();
    expect(within(databaseRow!).getByText('Unavailable')).toBeInTheDocument();
  });

  it('reports an unknown database state after API failure, and retries', async () => {
    fetchHealthMock.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(healthy);
    render(<ConnectionStatus />);
    expect(await screen.findByText('Unknown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
    expect(await screen.findByText('All services connected')).toBeInTheDocument();
    expect(fetchHealthMock).toHaveBeenCalledTimes(2);
  });
});
