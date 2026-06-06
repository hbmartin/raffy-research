import { setExistingUserPasswordCredential } from '@/modules/auth/backend';
import { createDbClient } from '@/modules/kernel/infrastructure/db/client';

type CliOptions = {
  email?: string;
  password?: string;
};

const passwordCredentialInputField = 'password' as const;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--email') {
      options.email = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--email=')) {
      options.email = arg.slice('--email='.length);
      continue;
    }
    if (arg === '--password') {
      options.password = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--password=')) {
      options.password = arg.slice('--password='.length);
    }
  }

  return options;
}

async function promptHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `${label} is required. Pass --password in non-interactive shells.`
    );
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';

    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode?.(false);
      stdin.pause();
    };

    const finish = () => {
      cleanup();
      stdout.write('\n');
      resolve(value);
    };

    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Password prompt cancelled.'));
          return;
        }

        if (char === '\r' || char === '\n') {
          finish();
          return;
        }

        if (char === '\u007f') {
          value = value.slice(0, -1);
          stdout.write('\b \b');
          continue;
        }

        value += char;
        stdout.write('*');
      }
    };

    stdout.write(`${label}: `);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function resolvePassword(options: CliOptions): Promise<string> {
  if (options.password !== undefined) return options.password;

  const first = await promptHidden('New password');
  const second = await promptHidden('Confirm password');
  if (first !== second) {
    throw new Error('Passwords do not match.');
  }

  return first;
}

const options = parseArgs(process.argv.slice(2));
const email = options.email?.trim().toLowerCase();

if (!email) {
  throw new Error(
    'Usage: pnpm auth:set-password -- --email user@example.com [--password ...]'
  );
}

const password = await resolvePassword(options);
if (password.length < 8) {
  throw new Error('Password must be at least 8 characters.');
}

const db = createDbClient();

try {
  const input = {
    email,
    [passwordCredentialInputField]: password,
  };
  const result = await setExistingUserPasswordCredential(db, input);
  if (result.isError()) throw result.getError();

  const outcome = result.get();
  if (outcome.type === 'user_not_found') {
    throw new Error(`No existing user found for ${email}.`);
  }

  console.log(`Password credentials set for ${outcome.email}.`);
} finally {
  await db.$close();
}
