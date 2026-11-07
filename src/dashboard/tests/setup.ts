import '@testing-library/jest-dom';

// Polyfill ResizeObserver for React Flow in JSDOM environment
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
