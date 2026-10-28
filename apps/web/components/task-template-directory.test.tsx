import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../lib/api-client';
import { planningTemplates } from '../test/planning-fixture';
import { realtimeUser, deferred } from '../test/realtime-fixture';
import { chooseSelectOption } from '../test/select-option';
import { useCurrentUser } from './session-provider';
import { TaskTemplateEditor } from './task-template-editor';
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./session-provider', () => ({ useCurrentUser: vi.fn() }));
const api = vi.mocked(apiRequest);
const auth = vi.mocked(useCurrentUser);
const template = planningTemplates[0]!;
beforeEach(() => {
  api.mockReset();
  auth.mockReturnValue(realtimeUser);
});
describe('Task template directory', () => {
  it('blocks crew before loading private template configuration', () => {
    auth.mockReturnValue({ ...realtimeUser, role: 'CREW_MEMBER', crewIds: ['crew'] });
    render(<TaskTemplateEditor />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(api).not.toHaveBeenCalled();
  });
  it('shows real catalog counts and filters the complete response locally without extra requests', async () => {
    api.mockResolvedValue({
      templates: [
        ...planningTemplates,
        {
          ...template,
          id: 'disabled',
          code: 'ASSEMBLE_CABINET',
          name: 'Assemble cabinet',
          active: false,
          required: false,
          severity: 'MEDIUM',
          applicability: 'DELIVERY_AND_ASSEMBLY',
        },
        {
          ...template,
          id: 'delivery',
          code: 'DELIVERY_CHECK',
          name: 'Inspect delivered furniture',
          applicability: 'DELIVERY_ONLY',
        },
      ],
    });
    const { container } = render(<TaskTemplateEditor />);
    await screen.findByText('Assemble cabinet');
    const overview = screen.getByRole('region', { name: 'Template overview' });
    expect(within(overview).getByText('4')).toBeInTheDocument();
    expect(within(overview).getByText('3')).toBeInTheDocument();
    expect(within(overview).getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveClass('task-template-table');
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(10);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search templates' }), {
      target: { value: 'DELIVERY_CHECK' },
    });
    expect(screen.getByText('Assemble cabinet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search templates' }));
    expect(screen.getByText('Inspect delivered furniture')).toBeInTheDocument();
    expect(screen.queryByText('Assemble cabinet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear template filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Filter templates' }));
    await chooseSelectOption('Service applicability', 'Delivery only');
    fireEvent.click(screen.getByRole('button', { name: 'Apply template filters' }));
    expect(screen.getByText('Inspect delivered furniture')).toBeInTheDocument();
    expect(screen.queryByText(template.name)).not.toBeInTheDocument();
    expect(
      screen.getByText('Showing 1 of 4 templates · Search and filters apply to the full catalog.'),
    ).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
  });
  it('preserves a draft on refresh and opens a clean editor for another template', async () => {
    let current = planningTemplates;
    api.mockImplementation(async () => ({ templates: current }));
    render(<TaskTemplateEditor />);
    fireEvent.click(await screen.findByRole('button', { name: `Edit template ${template.code}` }));
    const dialog = screen.getByRole('dialog', { name: 'Edit task template' });
    const input = within(dialog).getByLabelText('Task name');
    fireEvent.change(input, { target: { value: 'Draft task name' } });
    current = planningTemplates.map((row) =>
      row.id === template.id ? { ...row, name: 'Server renamed task' } : row,
    );
    await act(async () => {
      fireEvent.focus(window);
    });
    await screen.findByText('Server renamed task');
    expect(input).toHaveValue('Draft task name');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(
      screen.getByRole('button', { name: `Edit template ${planningTemplates[1]!.code}` }),
    );
    const next = screen.getByRole('dialog');
    expect(within(next).getByLabelText('Task name')).toHaveValue(planningTemplates[1]!.name);
    expect(screen.queryByDisplayValue('Draft task name')).not.toBeInTheDocument();
    expect(api.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });
  it('blocks closing and Escape while the original form mutation is pending', async () => {
    const pending = deferred<unknown>();
    api.mockImplementation(async (_path, options) =>
      options?.method === 'PATCH' ? pending.promise : { templates: planningTemplates },
    );
    render(<TaskTemplateEditor />);
    fireEvent.click(await screen.findByRole('button', { name: `Edit template ${template.code}` }));
    const dialog = screen.getByRole('dialog');
    const form = within(dialog).getByRole('form', { name: `Edit template ${template.code}` });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(within(dialog).getByRole('button', { name: 'Close template editor' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(api.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1);
    await act(async () => pending.resolve({ template }));
    await within(dialog).findByText(
      'Task template updated. Existing assignment snapshots were preserved.',
    );
    expect(within(dialog).getByRole('button', { name: 'Close template editor' })).toBeEnabled();
  });
  it('keeps the saved disabled record open after its enabled-filter row disappears and restores fallback focus', async () => {
    let current = template;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'PATCH') {
        current = { ...template, active: false };
        return { template: current };
      }
      return { templates: [current] };
    });
    render(<TaskTemplateEditor />);
    await screen.findByText(template.name);
    fireEvent.click(screen.getByRole('button', { name: 'Filter templates' }));
    await chooseSelectOption('Template status', 'Enabled');
    fireEvent.click(screen.getByRole('button', { name: 'Apply template filters' }));
    fireEvent.click(screen.getByRole('button', { name: `Edit template ${template.code}` }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('Template enabled'));
    fireEvent.submit(within(dialog).getByRole('form'));
    await within(dialog).findByText(
      'Task template updated. Existing assignment snapshots were preserved.',
    );
    await screen.findByText('No matching templates');
    expect(within(dialog).getByLabelText('Task name')).toHaveValue(template.name);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close template editor' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Create a task template' })).toHaveFocus();
  });
});
