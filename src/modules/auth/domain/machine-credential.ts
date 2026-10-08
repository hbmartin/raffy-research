import { z } from 'zod';

export const MACHINE_CAPABILITIES = [
  'research',
  'newsletter',
  'pipeline',
  'lab',
] as const;
export const zMachineCapabilities = z
  .array(z.enum(MACHINE_CAPABILITIES))
  .min(1)
  .max(4);
export type MachineCapability = (typeof MACHINE_CAPABILITIES)[number];
export type MachineIdentity = {
  credentialId: string;
  userId: string;
  name: string;
  role: 'user' | 'admin';
  capabilities: MachineCapability[];
};
