import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function installDeliveryProbe(root) {
  const { DeliveryWorkerHost } = await import(
    pathToFileURL(join(root, 'apps/api/src/runtime/deliveryWorkerHost.js')).href
  );
  const events = [];
  for (const method of ['read', 'readHttp']) {
    const original = DeliveryWorkerHost.prototype[method];
    DeliveryWorkerHost.prototype[method] = async function (...args) {
      try {
        const result = await original.apply(this, args);
        const status = this.status();
        events.push({
          at: new Date().toISOString(),
          method,
          kind: args[0],
          outcome: 'success',
          code: null,
          lifecycle: status.lifecycle,
          reportFreshness: status.reportFreshness,
          exitConfirmed: status.exitConfirmed,
          failureCode: status.failureCode,
          pendingRequests: status.pendingRequests,
        });
        return result;
      } catch (error) {
        const status = this.status();
        events.push({
          at: new Date().toISOString(),
          method,
          kind: args[0],
          outcome: 'failure',
          code: error instanceof Error ? error.message : String(error),
          lifecycle: status.lifecycle,
          reportFreshness: status.reportFreshness,
          exitConfirmed: status.exitConfirmed,
          failureCode: status.failureCode,
          pendingRequests: status.pendingRequests,
        });
        throw error;
      }
    };
  }
  return events;
}
