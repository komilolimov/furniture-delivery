import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// Radix Select scrolls focused options; jsdom has no layout/scroll implementation.
// Positioning and real scrolling remain browser QA, while keyboard state is exercised here.
if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
}
