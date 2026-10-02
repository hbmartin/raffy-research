import { useState } from 'react';

import { Button } from '@/platform/components/ui/button';
import { Input } from '@/platform/components/ui/input';

import type { EvidenceSource, TrackedTopic } from '../domain/newsletter';

type Correction = {
  topicId: string;
  action: 'rename' | 'merge' | 'split' | 'assign';
  title?: string;
  targetId?: string;
  sourceIds?: string[];
};
export function TopicCorrections({
  topics,
  sources,
  onCorrect,
  pending,
}: {
  topics: TrackedTopic[];
  sources: EvidenceSource[];
  onCorrect: (input: Correction) => void;
  pending: boolean;
}) {
  const [topicId, setTopicId] = useState('');
  const [action, setAction] = useState<Correction['action']>('rename');
  const [title, setTitle] = useState('');
  const [targetId, setTargetId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const active = topics.filter((t) => !t.mergedInto);
  const topic = active.find((t) => t.id === topicId);
  return (
    <details>
      <summary className="cursor-pointer font-medium">
        Tracked topics ({active.length})
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {active.map((t) => (
            <li className="rounded-md border p-3" key={t.id}>
              <strong>{t.title}</strong>
              <p className="text-sm text-muted-foreground">{t.summary}</p>
              <span className="text-xs">
                {t.sourceIds.length} linked captures
              </span>
            </li>
          ))}
        </ul>
        {active.length > 0 ? (
          <form
            className="flex flex-col gap-3 rounded-md border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              onCorrect({
                topicId,
                action,
                title,
                targetId,
                sourceIds: selected,
              });
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              Topic
              <select
                className="h-9 rounded-md border bg-background px-2"
                value={topicId}
                onChange={(e) => {
                  setTopicId(e.target.value);
                  setSelected([]);
                }}
              >
                <option value="">Choose a topic</option>
                {active.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Correction
              <select
                className="h-9 rounded-md border bg-background px-2"
                value={action}
                onChange={(e) => {
                  setAction(e.target.value as Correction['action']);
                  setSelected([]);
                }}
              >
                <option value="rename">Rename</option>
                <option value="merge">Merge into another topic</option>
                <option value="split">Split evidence into a new topic</option>
                <option value="assign">Correct evidence assignments</option>
              </select>
            </label>
            {action === 'rename' || action === 'split' ? (
              <label className="text-sm">
                Topic title
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
            ) : null}
            {action === 'merge' ? (
              <label className="flex flex-col gap-1 text-sm">
                Merge target
                <select
                  className="h-9 rounded-md border bg-background px-2"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <option value="">Choose a target</option>
                  {active
                    .filter((t) => t.id !== topicId)
                    .map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            {action === 'split' || action === 'assign' ? (
              <fieldset className="max-h-64 overflow-auto">
                <legend className="text-sm font-medium">
                  Evidence to move
                </legend>
                {sources
                  .filter(
                    (s) =>
                      !s.junk &&
                      (action === 'assign' || topic?.sourceIds.includes(s.id))
                  )
                  .map((s) => (
                    <label
                      key={s.id}
                      className="flex items-start gap-2 py-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(s.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, s.id]
                              : selected.filter((id) => id !== s.id)
                          )
                        }
                      />
                      {s.title}
                    </label>
                  ))}
              </fieldset>
            ) : null}
            <Button
              type="submit"
              disabled={pending || !topic}
              className="self-start"
            >
              Apply topic correction
            </Button>
            <p className="text-xs text-muted-foreground">
              Corrections preserve source provenance and angle snoozes.
            </p>
          </form>
        ) : null}
      </div>
    </details>
  );
}
