import { z } from 'zod';

import { zu } from '@/platform/lib/zod/zod-utils';

export const authPasswordField = 'password' as const;

export type FormFieldsLogin = z.infer<ReturnType<typeof zFormFieldsLogin>>;
export const zFormFieldsLogin = () =>
  z.object({
    email: zu.fieldText.required({ error: 'auth:common.email.required' }).pipe(
      z.email({
        error: (issue) =>
          issue.input
            ? 'auth:common.email.invalid'
            : 'auth:common.email.required',
      })
    ),
    [authPasswordField]: zu.fieldText.required({
      error: 'auth:common.password.required',
    }),
  });

export type FormFieldsOnboarding = z.infer<
  ReturnType<typeof zFormFieldsOnboarding>
>;
export const zFormFieldsOnboarding = () =>
  z.object({
    name: zu.fieldText.required(),
  });
