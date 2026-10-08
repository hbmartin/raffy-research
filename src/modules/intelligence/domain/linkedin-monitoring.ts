import { unique } from 'remeda';
import { z } from 'zod';

/** LinkedIn handles are case insensitive; tracking parameters are not identity. */
export function normalizeLinkedinUrl(value: string, personOnly = false) {
  const parsed = z.url().safeParse(value.trim());
  if (!parsed.success) return undefined;
  const url = new URL(parsed.data);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !(
      url.hostname === 'linkedin.com' ||
      url.hostname === 'www.linkedin.com' ||
      url.hostname === 'm.linkedin.com' ||
      /^[a-z]{2,3}\.linkedin\.com$/.test(url.hostname)
    ) ||
    url.username ||
    url.password ||
    url.port
  )
    return undefined;
  const segments = url.pathname.toLowerCase().replace(/\/$/, '').split('/');
  const [root, kind, handle] = segments;
  if (
    segments.length !== 3 ||
    root !== '' ||
    !handle ||
    !['in', 'company'].includes(kind ?? '') ||
    (personOnly && kind !== 'in')
  )
    return undefined;
  // Only non-ASCII UTF-8 escapes are accepted; encoded delimiters are ambiguous.
  if (!/^[a-z0-9_-]+$/.test(handle.replace(/%[89a-f][a-f0-9]/g, 'x')))
    return undefined;
  return `https://www.linkedin.com/${kind}/${handle}/`;
}

export const linkedinSelectionSchema = z
  .object({
    workspaceId: z.string().trim().min(1),
    profiles: z
      .array(
        z
          .object({
            url: z
              .string()
              .trim()
              .refine(
                (url) => !!normalizeLinkedinUrl(url, true),
                'Expected a LinkedIn person profile URL'
              )
              .transform((url) => normalizeLinkedinUrl(url, true)!),
            name: z.string().trim().min(1).optional(),
            reason: z.string().trim().min(1).optional(),
            evidence: z
              .array(
                z.object({
                  url: z
                    .url()
                    .refine((url) =>
                      ['http:', 'https:'].includes(new URL(url).protocol)
                    ),
                  note: z.string().trim().min(1),
                  observedAt: z.iso.datetime().optional(),
                })
              )
              .optional(),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();

export type LinkedinSelection = z.infer<typeof linkedinSelectionSchema>;
export type LinkedinProfileSelection = LinkedinSelection['profiles'][number];

export const linkedinPendingSchema = z
  .object({
    version: z.literal(1),
    taskId: z.string().min(1),
    createdAt: z.iso.datetime(),
    baseline: z.array(z.string()),
    intended: z.array(z.string()),
    failureCode: z.string().optional(),
  })
  .strict();
export type LinkedinPendingSync = z.infer<typeof linkedinPendingSchema>;

export const sortedTargets = (urls: string[]) => unique(urls).sort();
export const sameTargets = (left: string[], right: string[]) =>
  JSON.stringify(sortedTargets(left)) === JSON.stringify(sortedTargets(right));

export function validateLinkedinSelection(input: unknown, workspaceId: string) {
  const parsed = linkedinSelectionSchema.safeParse(input);
  if (!parsed.success)
    return {
      type: 'invalid_selection',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    } as const;
  if (parsed.data.workspaceId !== workspaceId)
    return { type: 'workspace_mismatch' } as const;
  if (
    unique(parsed.data.profiles.map((profile) => profile.url)).length !==
    parsed.data.profiles.length
  )
    return { type: 'duplicate_selection' } as const;
  return { type: 'selection_valid', selection: parsed.data } as const;
}
