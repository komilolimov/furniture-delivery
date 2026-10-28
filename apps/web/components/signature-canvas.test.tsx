import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasMocks } from '../test/signature-canvas-mocks';
import { SignatureCanvas, type SignatureCanvasHandle } from './signature-canvas';

let mocks: ReturnType<typeof canvasMocks>;
const originalDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
beforeEach(() => {
  mocks = canvasMocks();
});
afterEach(() => {
  cleanup();
  mocks.restoreDialog();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalDpr) Object.defineProperty(window, 'devicePixelRatio', originalDpr);
});
function draw() {
  const canvas = screen.getByLabelText('Signature drawing area');
  fireEvent.pointerDown(canvas, { pointerId: 7, pointerType: 'pen', clientX: 64, clientY: 22 });
  fireEvent.pointerMove(canvas, { pointerId: 7, pointerType: 'pen', clientX: 320, clientY: 110 });
  return canvas;
}
describe('Signature canvas with mocked drawing APIs', () => {
  it('requires actual drawn strokes and exports only an explicit bounded PNG', async () => {
    const ref = createRef<SignatureCanvasHandle>(),
      changed = vi.fn();
    render(<SignatureCanvas ref={ref} onChange={changed} />);
    expect(await ref.current!.exportPng()).toBeNull();
    const canvas = draw();
    fireEvent.pointerUp(canvas, { pointerId: 7, clientX: 320, clientY: 110 });
    expect(changed).toHaveBeenLastCalledWith(true);
    const blob = await ref.current!.exportPng();
    expect(blob?.type).toBe('image/png');
    expect(mocks.exports).toEqual([{ width: 1024, height: 360 }]);
    expect(mocks.context.lineTo).toHaveBeenCalledWith(512, 180);
  });
  it('retains strokes on resize, DPR change and rotation, and clears explicitly', async () => {
    const ref = createRef<SignatureCanvasHandle>();
    render(<SignatureCanvas ref={ref} onChange={vi.fn()} />);
    const canvas = draw();
    fireEvent.pointerUp(canvas, { pointerId: 7, clientX: 320, clientY: 110 });
    await ref.current!.exportPng();
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    fireEvent.resize(window);
    fireEvent(window, new Event('orientationchange'));
    mocks.context.lineTo.mockClear();
    expect(await ref.current!.exportPng()).not.toBeNull();
    expect(mocks.context.lineTo).toHaveBeenCalledWith(512, 180);
    fireEvent.click(screen.getByRole('button', { name: 'Clear drawing' }));
    expect(await ref.current!.exportPng()).toBeNull();
  });
  it('ends a cancelled pointer while preserving previous ink and ignores later moves', async () => {
    const ref = createRef<SignatureCanvasHandle>();
    render(<SignatureCanvas ref={ref} onChange={vi.fn()} />);
    const canvas = draw();
    fireEvent.pointerCancel(canvas, { pointerId: 7 });
    const calls = mocks.context.lineTo.mock.calls.length;
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 620, clientY: 200 });
    expect(mocks.context.lineTo).toHaveBeenCalledTimes(calls);
    expect(await ref.current!.exportPng()).not.toBeNull();
  });
  it('reports unavailable drawing honestly instead of generating ink from a name', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const ref = createRef<SignatureCanvasHandle>();
    render(<SignatureCanvas ref={ref} onChange={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Drawing is unavailable');
    expect(await ref.current!.exportPng()).toBeNull();
  });
});
