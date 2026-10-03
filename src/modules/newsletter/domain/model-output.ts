import { Result } from '@swan-io/boxed';
import { z } from 'zod';

import { zClaim } from './newsletter';

export const zPrepared = z.object({
  topics: z.array(
    z.object({
      id: z.string(),
      title: z.string().min(1),
      summary: z.string(),
      sourceIds: z.array(z.string()).min(1),
    })
  ),
  angles: z.array(
    z.object({
      id: z.string(),
      topicId: z.string(),
      title: z.string().min(1),
      takeaway: z.string().min(1),
      readerValue: z.string().min(1),
      claims: z.array(zClaim).min(1),
      sourceIds: z.array(z.string()).min(1),
      gaps: z.array(z.string()),
      counterevidence: z.array(z.string()),
    })
  ),
  sourceAssessments: z.array(
    z.object({
      sourceId: z.string(),
      authority: z.number().min(0).max(1),
      explanation: z.string().min(1),
    })
  ),
});
export function parseModel<T>(text: string, schema: z.ZodType<T>) {
  const decoded = Result.fromExecution(
    () =>
      JSON.parse(
        text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
      ) as unknown
  );
  if (decoded.isError())
    return { type: 'model_invalid' as const, issues: ['Invalid JSON'] };
  const result = schema.safeParse(decoded.get());
  return result.success
    ? { type: 'model_parsed' as const, value: result.data }
    : {
        type: 'model_invalid' as const,
        issues: result.error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`
        ),
      };
}
