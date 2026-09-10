import { afterEach } from 'vitest';
import { setImmediate } from 'node:timers';

// Synchronous geometry sweeps can starve the worker's task-update RPC socket
// across consecutive tests. Service I/O between tests instead of lengthening
// RPC/test timeouts or weakening their assertions.
afterEach(() => new Promise<void>(resolve => setImmediate(resolve)));
