import { DeliveryWorkerHost } from '../../src/runtime/deliveryWorkerHost.js';

const injectDelays = (process.env.WX_TEST_INJECT_DELAY ?? '').split(',').map((s) => s.trim());

if (injectDelays.includes('b18-ready')) {
  const originalConnectReader = DeliveryWorkerHost.prototype.connectReader;
  DeliveryWorkerHost.prototype.connectReader = async function (this: unknown, ...args: unknown[]) {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    return Reflect.apply(originalConnectReader, this, args);
  } as typeof originalConnectReader;
}
