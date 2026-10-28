import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { planningTemplates } from '../test/planning-fixture';
import { realtimeUser } from '../test/realtime-fixture';
import { TaskTemplateEditor } from './task-template-editor';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./session-provider', () => ({ useCurrentUser: () => realtimeUser }));
const api = vi.mocked(apiRequest);
beforeEach(() => {
  api.mockReset();
});

describe('task template management', () => {
  it('supports loading, errors, retry and an empty template catalog', async () => {
    api
      .mockRejectedValueOnce(new ApiError(0, 'API unavailable'))
      .mockResolvedValue({ templates: [] });
    render(<TaskTemplateEditor />);
    await screen.findByText('API unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No task templates yet')).toBeInTheDocument();
  });
  it('creates a persisted template with applicability, required, severity and priority', async () => {
    const created = {
      ...planningTemplates[0]!,
      code: 'STAIR_CHECK',
      name: 'Check stairs',
      applicability: 'DELIVERY_ONLY' as const,
    };
    let data = { templates: [] as typeof planningTemplates };
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        data = { templates: [created] };
        return { template: created };
      }
      return data;
    });
    render(<TaskTemplateEditor />);
    await screen.findByText('No task templates yet');
    fireEvent.click(screen.getByText('Create a task template'));
    const form = screen.getByRole('form', { name: 'Create task template' });
    fireEvent.change(within(form).getByLabelText('Stable template code'), {
      target: { value: 'STAIR_CHECK' },
    });
    fireEvent.change(within(form).getByLabelText('Task name'), {
      target: { value: 'Check stairs' },
    });
    fireEvent.change(within(form).getByLabelText('Applies to'), {
      target: { value: 'DELIVERY_ONLY' },
    });
    fireEvent.change(within(form).getByLabelText('Default severity'), {
      target: { value: 'HIGH' },
    });
    fireEvent.change(within(form).getByLabelText('Default priority'), { target: { value: '7' } });
    fireEvent.click(within(form).getByLabelText('Required for new matching assignments'));
    fireEvent.submit(form);
    await screen.findByText('Task template created.');
    expect(api).toHaveBeenCalledWith(
      '/task-templates',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          code: 'STAIR_CHECK',
          name: 'Check stairs',
          applicability: 'DELIVERY_ONLY',
          required: true,
          severity: 'HIGH',
          defaultPriority: 7,
          active: true,
        }),
      }),
    );
    expect(screen.getByText('Check stairs')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Create task template' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create a task template' }));
    expect(
      within(screen.getByRole('form', { name: 'Create task template' })).getByLabelText(
        'Task name',
      ),
    ).toHaveValue('');
  });
  it('keeps failed template edits, disables logically and never sends the stable code in PATCH', async () => {
    const template = planningTemplates[0]!;
    let attempted = false,
      current = template;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'PATCH') {
        if (!attempted) {
          attempted = true;
          throw new ApiError(500, 'The service is temporarily unavailable.');
        }
        current = { ...template, name: 'Edited task', active: false };
        return { template: current };
      }
      return { templates: [current] };
    });
    render(<TaskTemplateEditor />);
    await screen.findByText(template.name);
    fireEvent.click(screen.getByText(template.name));
    const form = screen.getByRole('form', { name: `Edit template ${template.code}` });
    fireEvent.change(within(form).getByLabelText('Task name'), {
      target: { value: 'Edited task' },
    });
    fireEvent.click(within(form).getByLabelText('Template enabled'));
    fireEvent.submit(form);
    await screen.findByText('The service is temporarily unavailable.');
    expect(within(form).getByLabelText('Task name')).toHaveValue('Edited task');
    fireEvent.submit(form);
    await screen.findByText('Task template updated. Existing assignment snapshots were preserved.');
    const [, request] = api.mock.calls.find(([, options]) => options?.method === 'PATCH')!;
    expect(request?.body).toMatchObject({ name: 'Edited task', active: false });
    expect(request?.body).not.toHaveProperty('code');
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
  it('prevents duplicate creation while the first submission is pending', async () => {
    let finish: ((value: unknown) => void) | undefined;
    api.mockImplementation(async (_path, options) =>
      options?.method === 'POST'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { templates: [] },
    );
    render(<TaskTemplateEditor />);
    await screen.findByText('No task templates yet');
    fireEvent.click(screen.getByText('Create a task template'));
    const form = screen.getByRole('form', { name: 'Create task template' });
    fireEvent.change(within(form).getByLabelText('Stable template code'), {
      target: { value: 'NEW-TASK' },
    });
    fireEvent.change(within(form).getByLabelText('Task name'), { target: { value: 'New task' } });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    await act(async () => {
      finish?.({ template: planningTemplates[0] });
    });
    await waitFor(() => expect(screen.getByText('Task template created.')).toBeInTheDocument());
  });
});
