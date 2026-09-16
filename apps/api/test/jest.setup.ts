import { jest } from '@jest/globals';

const typedJest = jest as unknown as typeof import('jest');

Object.defineProperty(globalThis, 'jest', {
  value: typedJest,
  configurable: true,
  enumerable: true,
  writable: true,
});
