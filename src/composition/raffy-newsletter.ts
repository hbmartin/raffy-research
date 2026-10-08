import { Result } from '@swan-io/boxed';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { toUserId } from '@/modules/kernel';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import { zProfile } from '@/modules/newsletter';
import type { BusinessOutcome, PageInput } from '@/modules/operations';
import { enqueueOperation } from '@/modules/operations/backend';

import { type CommandOptions, required } from './raffy-research';
import { createRaffyRuntime, type RaffyRuntime } from './raffy-runtime';

export async function newsletterCommand(
  runtime: RaffyRuntime,
  command: string,
  workspaceId: string,
  options: CommandOptions,
  page: PageInput,
  input?: unknown
): Promise<ApplicationResult<BusinessOutcome>> {
  const userId = toUserId(runtime.identity.userId),
    base = { userId, workspaceId };
  if (command === 'settings' || command === 'offers' || command === 'angle') {
    const result = await runtime.newsletter.get(base);
    if (result.isError()) return Result.Error(result.getError());
    const value = result.get();
    if (value.type !== 'newsletter_found') return Result.Ok(value);
    if (command === 'settings')
      return Result.Ok({
        type: 'newsletter_settings',
        profile: value.state.profile,
        audienceSuggestion: value.audienceSuggestion,
        configurationIssue: value.configurationIssue,
      });
    if (command === 'angle') {
      const angleId = required(options, 'angle');
      const angle = value.state.offers.find((offer) => offer.id === angleId);
      return Result.Ok(
        angle
          ? {
              type: 'newsletter_angle_found',
              reportId: value.state.latestReportId,
              angle,
            }
          : {
              type: 'angle_unavailable',
              angleId,
              reportId: value.state.latestReportId,
            }
      );
    }
    return offerPage(value.state, page);
  }
  if (command === 'history')
    return runtime.newsletter.history({
      ...base,
      before: page.cursor,
      limit: page.limit,
    });
  if (command === 'detail')
    return runtime.newsletter.detail({ ...base, id: required(options, 'id') });
  if (command === 'export')
    return runtime.newsletter.export({
      ...base,
      draftId: required(options, 'id'),
      format: 'markdown',
    });
  if (command === 'reviews')
    return runtime.newsletter.equivalenceReviews({
      ...base,
      before: page.cursor,
      limit: page.limit,
    });
  if (['configure', 'prepare', 'select', 'regenerate'].includes(command)) {
    const payload = {
      command,
      ...(command === 'configure' ? { profile: zProfile.parse(input) } : {}),
      ...(command === 'select'
        ? {
            reportId: required(options, 'report'),
            angleId: required(options, 'angle'),
            overrideReason:
              typeof options['override-reason'] === 'string'
                ? options['override-reason']
                : undefined,
            replace: Boolean(options.replace),
          }
        : {}),
      ...(command === 'regenerate'
        ? {
            selectionId: required(options, 'selection'),
            feedback: required(options, 'feedback'),
          }
        : {}),
    };
    return enqueueOperation(
      runtime.db,
      {
        workspaceId,
        userId,
        credentialId: runtime.identity.credentialId,
        kind: 'newsletter',
        key: `${command}:${required(options, 'key')}`,
        input: payload,
      },
      async (db) => {
        const transactional = createRaffyRuntime(
          db,
          runtime.credential,
          runtime.identity
        );
        let result: ApplicationResult<BusinessOutcome>;
        if (command === 'configure')
          result = await transactional.newsletter.saveProfile({
            ...base,
            profile: zProfile.parse(payload.profile),
          });
        else if (command === 'prepare')
          result = await transactional.newsletter.prepareThemes(base);
        else if (command === 'select')
          result = await transactional.newsletter.select({
            ...base,
            reportId: payload.reportId!,
            angleId: payload.angleId!,
            overrideReason: payload.overrideReason,
            replace: payload.replace,
          });
        else
          result = await transactional.newsletter.regenerate({
            ...base,
            selectionId: payload.selectionId!,
            feedback: payload.feedback!,
          });
        return result;
      }
    );
  }
  let result: ApplicationResult<BusinessOutcome>;
  if (command === 'skip-angle')
    result = await runtime.newsletter.skipAngle({
      ...base,
      reportId: required(options, 'report'),
      angleId: required(options, 'angle'),
      skip: !options.unskip,
    });
  else if (command === 'skip')
    result = await runtime.newsletter.skip({
      ...base,
      reportId: required(options, 'report'),
      skip: !options.unskip,
    });
  else if (command === 'abandon')
    result = await runtime.newsletter.abandon({
      ...base,
      selectionId: required(options, 'selection'),
    });
  else if (command === 'review')
    result = await runtime.newsletter.decideEquivalence({
      ...base,
      reviewId: required(options, 'review'),
      action: z.enum(['confirm', 'separate', 'reverse']).parse(options.action),
    });
  else if (command === 'correct')
    result = await runtime.newsletter.correctTopic({
      ...base,
      topicId: required(options, 'topic'),
      action: z
        .enum(['rename', 'merge', 'split', 'assign'])
        .parse(options.action),
      title: typeof options.title === 'string' ? options.title : undefined,
      targetId: typeof options.target === 'string' ? options.target : undefined,
      sourceIds:
        typeof options['source-ids'] === 'string'
          ? options['source-ids'].split(',')
          : undefined,
    });
  else return Result.Ok({ type: 'unknown_command' });
  if (result.isError()) return Result.Error(result.getError());
  return result;
}

function offerPage(
  state: import('@/modules/newsletter').NewsletterState,
  page: PageInput
): ApplicationResult<BusinessOutcome> {
  const signature = createHash('sha256')
    .update(JSON.stringify([state.latestReportId, state.offers]))
    .digest('hex');
  const cursor = page.cursor
    ? z
        .tuple([z.string(), z.string()])
        .parse(JSON.parse(Buffer.from(page.cursor, 'base64url').toString()))
    : undefined;
  if (
    cursor &&
    (cursor[0] !== signature ||
      !state.offers.some((offer) => offer.id === cursor[1]))
  )
    return Result.Ok({
      type: 'offers_changed',
      recovery:
        'Fetch newsletter offers again for the current preparation before choosing an angle.',
    });
  const start = cursor
    ? state.offers.findIndex((offer) => offer.id === cursor[1]) + 1
    : 0;
  const offers = state.offers.slice(start, start + page.limit);
  return Result.Ok({
    type: 'newsletter_offers',
    reportId: state.latestReportId,
    skippedAngles: state.skippedAngles ?? [],
    offers: offers.map(
      ({
        id,
        topicId,
        title,
        takeaway,
        readerValue,
        sourceIds,
        verified,
        score,
        support,
        momentum,
        status,
        explanation,
      }) => ({
        id,
        topicId,
        title,
        takeaway,
        readerValue,
        sourceIds,
        verified,
        score,
        support,
        momentum,
        status,
        explanation,
      })
    ),
    nextCursor:
      start + offers.length < state.offers.length
        ? Buffer.from(JSON.stringify([signature, offers.at(-1)!.id])).toString(
            'base64url'
          )
        : null,
  });
}
