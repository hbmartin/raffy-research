import { useState } from 'react';

import { useHydrated } from '@/platform/hooks/use-hydrated';

import { Button } from '@/platform/components/ui/button';

import { machineApprove, machinePairing } from '../server';

type Pairing = Awaited<ReturnType<typeof machinePairing>>;
export function MachineApproval({ pairing }: { pairing: Pairing }) {
  const hydrated = useHydrated();
  const [outcome, setOutcome] = useState<string>();
  const [pending, setPending] = useState(false);
  if (pairing.type !== 'pairing_found')
    return (
      <p>
        This pairing request expired. Run <code>pnpm raffy auth login</code>{' '}
        again.
      </p>
    );
  const item = pairing.pairing;
  const decide = async (approve: boolean) => {
    setPending(true);
    try {
      setOutcome(
        (
          await machineApprove({
            data: { id: item.id, code: item.code, approve },
          })
        ).type
      );
    } catch {
      setOutcome('Approval failed. Refresh and try again.');
    } finally {
      setPending(false);
    }
  };
  return (
    <main
      className="mx-auto max-w-xl space-y-4 p-6"
      data-testid="machine-approval"
      data-hydrated={hydrated}
    >
      <h1 className="text-2xl font-semibold">Authorize Raffy CLI</h1>
      <p className="break-words">Machine: {item.name}</p>
      <p>
        Compare this code with your terminal: <strong>{item.code}</strong>
      </p>
      <p>Access: {item.capabilities.join(', ')}</p>
      <p>
        Pairing approval deadline:{' '}
        {new Date(item.pairingExpiresAt).toLocaleString()}
      </p>
      <p>Credential expires: {new Date(item.expiresAt).toLocaleString()}</p>
      <p>
        The CLI acts with your current app permissions. You can revoke the
        credential at any time.
      </p>
      {outcome ? (
        <p role="status">
          {(
            {
              credential_approved: 'Machine authorized',
              pairing_denied: 'Request denied',
              pairing_expired: 'Pairing expired; start login again',
              forbidden: 'Your current permissions do not allow this access',
            } as Record<string, string>
          )[outcome] ?? outcome}
        </p>
      ) : item.state !== 'pending' ? (
        <p role="status">Request {item.state}</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={pending || !hydrated}
            onClick={() => void decide(true)}
          >
            Approve machine
          </Button>
          <Button
            variant="secondary"
            disabled={pending || !hydrated}
            onClick={() => void decide(false)}
          >
            Deny
          </Button>
        </div>
      )}
    </main>
  );
}
