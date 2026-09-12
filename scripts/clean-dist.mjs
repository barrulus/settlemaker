import { rmSync } from 'node:fs';

// Resolve from this script so only this package's generated output is removed.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
