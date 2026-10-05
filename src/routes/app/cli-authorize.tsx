import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { MachineApproval } from '@/modules/auth/presentation';
import { machinePairing } from '@/modules/auth/server';

export const Route = createFileRoute('/app/cli-authorize')({
  validateSearch: z.object({ request: z.uuid() }),
  loaderDeps: ({ search }) => ({ request: search.request }),
  loader: ({ deps }) => machinePairing({ data: { id: deps.request } }),
  component: ApprovalRoute,
});
function ApprovalRoute() {
  return <MachineApproval pairing={Route.useLoaderData()} />;
}
