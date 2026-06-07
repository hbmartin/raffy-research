/* oxlint-disable no-process-env */
import { setExistingUserPasswordCredential } from '@/modules/auth/backend';
import { createDbClient } from '@/modules/kernel/infrastructure/db/client';

type CliOptions = {
  email?: string;
  passwordStdin?: boolean;
};

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
    if (arg === '--password' || arg.startsWith('--password=')) {
      throw new Error(
        'Do not pass passwords via argv. Use AUTH_SET_CREDENTIAL_PASSWORD or --password-stdin.'
      );
    }
    if (arg === '--password-stdin') {
      options.passwordStdin = true;
    }
  }

  return options;
}

async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

async function promptHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `${label} is required. Set AUTH_SET_CREDENTIAL_PASSWORD or pipe it with --password-stdin.`
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

        if (char === '\u007f' || char === '\u0008') {
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
  if (process.env.AUTH_SET_CREDENTIAL_PASSWORD !== undefined) {
    const password = process.env.AUTH_SET_CREDENTIAL_PASSWORD;
    if (password.trim().length === 0) {
      throw new Error('AUTH_SET_CREDENTIAL_PASSWORD must not be empty.');
    }
    return password;
  }
  if (options.passwordStdin) {
    const password = await readPasswordFromStdin();
    if (password.trim().length === 0) {
      throw new Error('--password-stdin must provide a non-empty password.');
    }
    return password;
  }

  const first = await promptHidden('New password');
  const second = await promptHidden('Confirm password');
  if (first !== second) {
    throw new Error('Passwords do not match.');
  }
  if (first.trim().length === 0) {
    throw new Error('Password must not be empty.');
  }

  return first;
}

const options = parseArgs(process.argv.slice(2));
const email = options.email?.trim().toLowerCase();

if (!email) {
  throw new Error(
    'Usage: pnpm auth:set-credential -- --email user@example.com [--password-stdin]'
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
    password,
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
