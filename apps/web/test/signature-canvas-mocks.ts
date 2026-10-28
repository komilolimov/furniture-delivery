import { vi } from 'vitest';

export function canvasMocks() {
  const context = {
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 640,
    bottom: 220,
    width: 640,
    height: 220,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  const exports: { width: number; height: number }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
  ) {
    exports.push({ width: this.width, height: this.height });
    callback(new Blob(['test-only-synthetic-stroke'], { type: 'image/png' }));
  });
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
      }
    },
  );
  const create = vi.fn(() => 'blob:test-only-signature'),
    revoke = vi.fn();
  const NativeUrl = URL;
  vi.stubGlobal(
    'URL',
    class extends NativeUrl {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const show = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    }),
    close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    });
  const oldShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal'),
    oldClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: show,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close });
  return {
    context,
    exports,
    create,
    revoke,
    show,
    close,
    restoreDialog: () => {
      if (oldShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', oldShow);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
      if (oldClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', oldClose);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    },
  };
}
