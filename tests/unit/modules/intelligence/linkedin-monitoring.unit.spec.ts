import type { Result } from '@swan-io/boxed';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeLinkedinUrl,
  validateLinkedinSelection,
} from '@/modules/intelligence';
import { createLinkedinProviderTask } from '@/modules/intelligence/testing';
import type { AppError } from '@/modules/kernel/domain/errors/app-error';

const person = 'https://www.linkedin.com/in/alice/';
function requireOk<T>(result: Result<T, AppError>): T {
  if (result.isError()) throw result.getError();
  return result.get();
}
function requireError<T>(result: Result<T, AppError>): AppError {
  if (result.isOk()) throw new Error('Expected infrastructure failure');
  return result.getError();
}

describe('LinkedIn selection identity', () => {
  it('normalizes tracking, host, scheme, handle case and trailing slash', () => {
    expect(
      normalizeLinkedinUrl(
        ' http://uk.linkedin.com/in/ALICE?trk=feed#about ',
        true
      )
    ).toBe(person);
    expect(normalizeLinkedinUrl('https://linkedin.com/company/Acme')).toBe(
      'https://www.linkedin.com/company/acme/'
    );
    expect(
      normalizeLinkedinUrl('https://www.linkedin.com/in/andr%C3%A9e/', true)
    ).toBe('https://www.linkedin.com/in/andr%c3%a9e/');
  });
  it.each([
    'https://www.linkedin.com/company/acme/',
    'https://www.linkedin.com/posts/alice',
    'https://linkedin.com.evil.example/in/alice',
    'https://user:secret@linkedin.com/in/alice',
    'ftp://linkedin.com/in/alice',
    'https://linkedin.com:444/in/alice',
    'not a URL',
    'https://linkedin.com/in/alice/activity',
    'https://linkedin.com/in/alice%2Fbob',
  ])('rejects unsupported person input %s', (url) => {
    expect(
      validateLinkedinSelection(
        { workspaceId: 'ws', profiles: [{ url }] },
        'ws'
      ).type
    ).toBe('invalid_selection');
  });
  it('rejects duplicates, empty selection, mismatched workspace and unknown fields', () => {
    expect(
      validateLinkedinSelection(
        {
          workspaceId: 'ws',
          profiles: [
            { url: person },
            { url: 'http://linkedin.com/in/Alice?utm=1' },
          ],
        },
        'ws'
      ).type
    ).toBe('duplicate_selection');
    expect(
      validateLinkedinSelection(
        { workspaceId: 'other', profiles: [{ url: person }] },
        'ws'
      ).type
    ).toBe('workspace_mismatch');
    expect(
      validateLinkedinSelection({ workspaceId: 'ws', profiles: [] }, 'ws').type
    ).toBe('invalid_selection');
    expect(
      validateLinkedinSelection(
        { workspaceId: 'ws', profiles: [{ url: person, role: 'CEO' }] },
        'ws'
      ).type
    ).toBe('invalid_selection');
    expect(
      validateLinkedinSelection(
        { workspaceId: 'ws', profiles: [{ url: person }] },
        'ws'
      ).type
    ).toBe('selection_valid');
  });
});

describe('Apify task adapter', () => {
  const ref = {
    taskId: 'task-1',
    scheduleId: 'schedule-1',
    credentialsRef: 'APIFY_TOKEN',
  };
  afterEach(() => vi.unstubAllGlobals());
  it('sends only targets, with bearer authentication and a bounded signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createLinkedinProviderTask({
      getCredential: () => 'private-token',
    });
    expect(requireOk(await provider.updateTargets(ref, [person]))).toEqual({
      type: 'targets_updated',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.apify.com/v2/actor-tasks/task-1/input');
    expect(JSON.parse(init.body)).toEqual({ targetUrls: [person] });
    expect(init.headers.Authorization).toBe('Bearer private-token');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('inspects the configured schedule and refuses target overrides', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ targetUrls: [person], scrapeComments: false })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              isEnabled: true,
              actions: [
                {
                  type: 'RUN_ACTOR_TASK',
                  actorTaskId: ref.taskId,
                  input: { targetUrls: [] },
                },
              ],
            },
          })
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = await createLinkedinProviderTask({
      getCredential: () => 'token',
    }).inspect(ref);
    expect(requireOk(result).type).toBe('provider_configuration_invalid');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('maps timeout and HTTP failures without leaking credentials or response bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(new DOMException('private-token', 'TimeoutError'))
    );
    const provider = createLinkedinProviderTask({
      getCredential: () => 'private-token',
    });
    const timeout = await provider.inspect(ref);
    expect(timeout.isError()).toBe(true);
    expect(requireError(timeout).code).toBe('PROVIDER_HTTP_ERROR');
    expect(JSON.stringify(requireError(timeout))).not.toContain(
      'private-token'
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private-token', { status: 403 }))
    );
    const failed = await provider.updateTargets(ref, [person]);
    expect(failed.isError()).toBe(true);
    expect(JSON.stringify(requireError(failed))).not.toContain('private-token');
  });
  it('rejects invalid target payloads and missing credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ targetUrls: ['https://evil.example/'] }))
      );
    vi.stubGlobal('fetch', fetchMock);
    expect(
      requireOk(
        await createLinkedinProviderTask({
          getCredential: () => 'token',
        }).inspect({ ...ref, scheduleId: undefined })
      ).type
    ).toBe('provider_configuration_invalid');
    expect(
      requireError(
        await createLinkedinProviderTask({
          getCredential: () => undefined,
        }).inspect(ref)
      ).code
    ).toBe('LINKEDIN_CREDENTIAL_MISSING');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
