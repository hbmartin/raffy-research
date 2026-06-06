import { TerminalIcon } from 'lucide-react';

import { useTypedAppFormContext } from '@/platform/components/form';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/platform/components/ui/alert';

import { type FormFieldsLogin } from '@/modules/auth/client';
import { envClient } from '@/platform/env/client';

const DEV_LOGIN_PASSWORD = 'password';

const LoginEmailButton = ({
  email,
  setLogin,
}: {
  email: string;
  setLogin: (email: string) => void;
}) => (
  <button
    type="button"
    className="cursor-pointer font-medium text-neutral-900 underline underline-offset-4 hover:no-underline dark:text-white"
    onClick={() => setLogin(email)}
  >
    {email.split('@')[0]}
  </button>
);

export const LoginEmailHint = () => {
  const form = useTypedAppFormContext({
    defaultValues: { email: '', password: '' } satisfies FormFieldsLogin,
  });

  if (
    envClient.VITE_VISUAL_TEST ||
    (import.meta.env.PROD && !envClient.VITE_IS_DEMO)
  ) {
    return null;
  }

  const setLogin = (email: string) => {
    form.setFieldValue('email', email);
    form.setFieldValue('password', DEV_LOGIN_PASSWORD);
  };

  return (
    <Alert dir="ltr">
      <TerminalIcon className="size-4" />
      <AlertTitle>
        {envClient.VITE_IS_DEMO ? 'Demo mode' : 'Dev mode'}
      </AlertTitle>
      <AlertDescription className="flex flex-wrap gap-x-1 text-sm leading-4">
        You can login with{' '}
        <LoginEmailButton email="admin@admin.com" setLogin={setLogin} />
        {' or '}
        <LoginEmailButton email="user@user.com" setLogin={setLogin} />
        {' using '}
        <span className="font-medium text-neutral-900 dark:text-white">
          {DEV_LOGIN_PASSWORD}
        </span>
      </AlertDescription>
    </Alert>
  );
};
