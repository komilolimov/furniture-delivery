import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/** Exercise the Radix combobox through its accessible keyboard interaction. */
export async function chooseSelectOption(label: string, optionLabel: string): Promise<void> {
  const trigger = screen.getByRole('combobox', { name: label });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: optionLabel });
  option.focus();
  fireEvent.keyDown(option, { key: 'Enter' });
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: label })).toHaveTextContent(optionLabel),
  );
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}
