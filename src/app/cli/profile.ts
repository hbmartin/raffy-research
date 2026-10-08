import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { readRuntimeEnv } from '@/platform/env/runtime-env';

const zProfile = z.object({
  id: z.uuid(),
  secret: z.string().min(32),
  baseUrl: z.url(),
  workspaceId: z.string().optional(),
});
export type CliProfile = z.infer<typeof zProfile>;
export const profileDirectory = () => {
  const directory = readRuntimeEnv().XDG_CONFIG_HOME;
  return join(
    typeof directory === 'string' ? directory : join(homedir(), '.config'),
    'raffy'
  );
};
export function profilePath(name = 'default') {
  if (!/^[a-z0-9-]{1,64}$/u.test(name))
    throw new Error(
      'Profile names use lowercase letters, numbers, and hyphens.'
    );
  return join(profileDirectory(), `${name}.json`);
}
export async function readProfile(name?: string): Promise<CliProfile> {
  const path = profilePath(name);
  if (((await stat(path)).mode & 0o077) !== 0)
    throw new Error(
      'Credential file must have owner-only permissions (chmod 600).'
    );
  return zProfile.parse(JSON.parse(await readFile(path, 'utf8')));
}
export async function writeProfile(profile: CliProfile, name?: string) {
  const directory = profileDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = profilePath(name),
    temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(profile), {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, path);
}
export const removeProfile = (name?: string) =>
  rm(profilePath(name), { force: true });
