import { Result } from '@swan-io/boxed';
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import { match, P } from 'ts-pattern';
import { z } from 'zod';

const dependencies = createServerOnlyFn(async () => {
  const [
    { createMachineCredentials, withProtectedContext, withProtectedMutation },
    { getKernel },
  ] = await Promise.all([
    import('../../backend'),
    import('@/composition/kernel'),
  ]);
  return {
    credentials: createMachineCredentials(getKernel().db),
    withProtectedContext,
    withProtectedMutation,
  };
});
export const machinePairing = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const deps = await dependencies();
    return deps.withProtectedContext(async () =>
      match(await deps.credentials.pairing(data.id))
        .with(Result.P.Ok(P.select()), (value) => value)
        .with(Result.P.Error(P.select()), (error) => {
          throw error;
        })
        .exhaustive()
    );
  });
export const machineApprove = createServerFn({ method: 'POST' })
  .validator(
    z.object({ id: z.uuid(), code: z.string().length(8), approve: z.boolean() })
  )
  .handler(async ({ data }) => {
    const deps = await dependencies();
    return deps.withProtectedMutation(async (ctx) =>
      match(await deps.credentials.approve({ ...data, userId: ctx.user.id }))
        .with(Result.P.Ok(P.select()), (value) => value)
        .with(Result.P.Error(P.select()), (error) => {
          throw error;
        })
        .exhaustive()
    );
  });
