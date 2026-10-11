export interface DeliveryProbeEvent {
  at: string;
  method: string;
  kind: string;
  outcome: 'success' | 'failure';
  code: string | null;
  lifecycle: string;
  reportFreshness: string;
  exitConfirmed: boolean;
  failureCode: string | null;
  pendingRequests: number;
}

export function installDeliveryProbe(root: string): Promise<DeliveryProbeEvent[]>;
