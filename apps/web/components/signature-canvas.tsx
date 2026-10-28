'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PointerEvent } from 'react';

type Point = { x: number; y: number };
type Stroke = Point[];
export interface SignatureCanvasHandle {
  exportPng: () => Promise<Blob | null>;
  clear: () => void;
}
function paint(canvas: HTMLCanvasElement, strokes: Stroke[]): boolean {
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#142b26';
  context.lineWidth = Math.max(2, canvas.width / 350);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    context.beginPath();
    context.moveTo(stroke[0]!.x * canvas.width, stroke[0]!.y * canvas.height);
    for (const point of stroke.slice(1))
      context.lineTo(point.x * canvas.width, point.y * canvas.height);
    context.stroke();
  }
  return true;
}

/** Only normalized x/y strokes live in memory; pressure, timing and device data are not collected. */
export const SignatureCanvas = forwardRef<
  SignatureCanvasHandle,
  {
    disabled?: boolean;
    onChange: (hasInk: boolean) => void;
  }
>(function SignatureCanvas({ disabled = false, onChange }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null),
    strokes = useRef<Stroke[]>([]);
  const pointer = useRef<number | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const [supported, setSupported] = useState(true);
  function redraw() {
    if (canvas.current) {
      try {
        if (!paint(canvas.current, strokes.current)) setSupported(false);
      } catch {
        setSupported(false);
      }
    }
  }
  function clear() {
    strokes.current = [];
    pointer.current = null;
    redraw();
    changed.current(false);
  }
  useImperativeHandle(ref, () => ({
    clear,
    async exportPng() {
      if (!supported || !strokes.current.some((stroke) => stroke.length >= 2)) return null;
      const output = document.createElement('canvas');
      output.width = 1024;
      output.height = 360;
      if (!paint(output, strokes.current)) return null;
      return new Promise<Blob | null>((resolve) =>
        output.toBlob((blob) => resolve(blob && blob.size <= 262144 ? blob : null), 'image/png'),
      );
    },
  }));
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    function resize() {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      element.width = Math.min(2048, Math.max(1, Math.round((rect.width || 640) * ratio)));
      element.height = Math.min(1024, Math.max(1, Math.round((rect.height || 220) * ratio)));
      try {
        if (!paint(element, strokes.current)) setSupported(false);
      } catch {
        setSupported(false);
      }
    }
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(element);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      strokes.current = [];
      pointer.current = null;
    };
  }, []);
  function point(event: PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 640))),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / (rect.height || 220))),
    };
  }
  function end(event: PointerEvent<HTMLCanvasElement>, cancelled = false) {
    if (pointer.current !== event.pointerId) return;
    if (!cancelled) strokes.current.at(-1)?.push(point(event));
    pointer.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* Capture may already be released. */
    }
    redraw();
    changed.current(strokes.current.some((stroke) => stroke.length >= 2));
  }
  return (
    <div className="signature-pad">
      <p id="signature-instructions">
        Draw with a mouse, finger or stylus in this box. Drawing unavailable? Record an absence with
        its reason.
      </p>
      <canvas
        ref={canvas}
        className="signature-canvas"
        aria-label="Signature drawing area"
        aria-describedby="signature-instructions"
        onPointerDown={(event) => {
          if (
            disabled ||
            !supported ||
            pointer.current !== null ||
            (event.pointerType === 'mouse' && event.button !== 0)
          )
            return;
          pointer.current = event.pointerId;
          strokes.current.push([point(event)]);
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            /* Pointer capture is optional for supported browsers. */
          }
        }}
        onPointerMove={(event) => {
          if (disabled || pointer.current !== event.pointerId) return;
          strokes.current.at(-1)?.push(point(event));
          redraw();
          changed.current(strokes.current.some((stroke) => stroke.length >= 2));
        }}
        onPointerUp={(event) => end(event)}
        onPointerCancel={(event) => end(event, true)}
      />
      {!supported && (
        <p className="form-error" role="alert">
          Drawing is unavailable on this device. Use the absence workflow; a typed name is not a
          signature.
        </p>
      )}
      <button type="button" className="secondary-button" disabled={disabled} onClick={clear}>
        Clear drawing
      </button>
    </div>
  );
});
