import { describe, it, expect } from 'vitest';
import { IdAllocator } from '../src/output/id-allocator.js';

describe('IdAllocator', () => {
  it('allocates zero-indexed IDs per prefix', () => {
    const a = new IdAllocator();
    expect(a.alloc('b')).toBe('b0');
    expect(a.alloc('b')).toBe('b1');
    expect(a.alloc('s')).toBe('s0');
    expect(a.alloc('p')).toBe('p0');
    expect(a.alloc('b')).toBe('b2');
  });

  it('keeps prefix counters independent', () => {
    const a = new IdAllocator();
    for (let i = 0; i < 5; i++) a.alloc('b');
    expect(a.alloc('s')).toBe('s0');
    expect(a.alloc('p')).toBe('p0');
    expect(a.alloc('b')).toBe('b5');
  });

  it('is instance-scoped (separate allocators do not share state)', () => {
    const a = new IdAllocator();
    const b = new IdAllocator();
    expect(a.alloc('b')).toBe('b0');
    expect(b.alloc('b')).toBe('b0');
  });
});
