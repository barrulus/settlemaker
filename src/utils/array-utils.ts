import { SeededRandom } from './random.js';

/** Fisher-Yates shuffle returning new array */
export function shuffle<T>(a: T[], rng: SeededRandom): T[] {
  const result: T[] = [];
  for (const e of a) {
    result.splice(Math.floor(rng.float() * (result.length + 1)), 0, e);
  }
  return result;
}

/** Pick a random element */
export function randomElement<T>(a: T[], rng: SeededRandom): T {
  return a[Math.floor(rng.float() * a.length)];
}

/** Return element minimizing fn */
export function minBy<T>(a: T[], fn: (el: T) => number): T {
  let result = a[0];
  let min = fn(result);
  for (let i = 1; i < a.length; i++) {
    const measure = fn(a[i]);
    if (measure < min) {
      result = a[i];
      min = measure;
    }
  }
  return result;
}

/** Return element maximizing fn */
export function maxBy<T>(a: T[], fn: (el: T) => number): T {
  let result = a[0];
  let max = fn(result);
  for (let i = 1; i < a.length; i++) {
    const measure = fn(a[i]);
    if (measure > max) {
      result = a[i];
      max = measure;
    }
  }
  return result;
}

/** Add element only if not already present (identity-based) */
export function addUnique<T>(a: T[], el: T): void {
  if (a.indexOf(el) === -1) a.push(el);
}

/** Return elements in a that are not in b */
export function difference<T>(a: T[], b: T[]): T[] {
  return a.filter(el => b.indexOf(el) === -1);
}

/** Replace first occurrence of el with newEls in place */
export function replaceElement<T>(a: T[], el: T, newEls: T[]): void {
  let index = a.indexOf(el);
  if (index === -1) return;
  a[index++] = newEls[0];
  for (let i = 1; i < newEls.length; i++) {
    a.splice(index++, 0, newEls[i]);
  }
}

/** Count elements matching predicate */
export function count<T>(a: T[], test: (el: T) => boolean): number {
  let c = 0;
  for (const e of a) if (test(e)) c++;
  return c;
}

/** Last element of array */
export function last<T>(a: T[]): T {
  return a[a.length - 1];
}
