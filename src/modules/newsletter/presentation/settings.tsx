import { useId, useState } from 'react';

import { Button } from '@/platform/components/ui/button';
import { Input } from '@/platform/components/ui/input';
import { Label } from '@/platform/components/ui/label';
import { Textarea } from '@/platform/components/ui/textarea';

import { type NewsletterProfile, zProfile } from '../domain/newsletter';

export function NewsletterSettings({
  profile,
  audienceSuggestion,
  onSave,
  pending,
}: {
  profile: NewsletterProfile | null;
  audienceSuggestion: string;
  onSave: (profile: NewsletterProfile) => Promise<boolean>;
  pending: boolean;
}) {
  const id = useId();
  const baseline = {
    audience: profile?.audience ?? audienceSuggestion,
    guidance: profile?.guidance ?? '',
    samples: profile?.samples.join('\n===SAMPLE===\n') ?? '',
    provider: profile?.runtime.provider ?? '',
    model: profile?.runtime.model ?? '',
    enabled: profile?.enabled ?? true,
    halfLife: profile?.halfLifeDays ?? 90,
    minutes: profile?.researchMinutes ?? 5,
    pages: profile?.researchPages ?? 10,
    context: profile?.runtime.contextWindowTokens?.toString() ?? '',
  };
  // Untouched fields follow fresh server data; edited fields belong to this form.
  const [dirty, setDirty] = useState<Partial<typeof baseline>>({});
  const [error, setError] = useState('');
  const values = { ...baseline, ...dirty };
  const change = <K extends keyof typeof baseline>(
    key: K,
    value: (typeof baseline)[K]
  ) => setDirty((current) => ({ ...current, [key]: value }));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        const parsed = zProfile.safeParse({
          audience: values.audience,
          guidance: values.guidance,
          samples: values.samples
            .split('===SAMPLE===')
            .map((sample) => sample.trim())
            .filter(Boolean),
          enabled: values.enabled,
          halfLifeDays: values.halfLife,
          researchMinutes: values.minutes,
          researchPages: values.pages,
          runtime: {
            mode: values.provider === 'openai' ? 'hosted' : 'local',
            provider: values.provider,
            model: values.model,
            contextWindowTokens: values.context.trim()
              ? Number(values.context)
              : undefined,
          },
        });
        if (!parsed.success) {
          setError(
            parsed.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('; ')
          );
          return;
        }
        if (await onSave(parsed.data)) setDirty({});
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-audience`}>Newsletter readership</Label>
        <Textarea
          required
          maxLength={4000}
          id={`${id}-audience`}
          value={values.audience}
          onChange={(event) => change('audience', event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-guidance`}>House writing guidance</Label>
        <Textarea
          maxLength={12000}
          id={`${id}-guidance`}
          value={values.guidance}
          onChange={(event) => change('guidance', event.target.value)}
          placeholder="Voice, structure, length, terminology, and editorial preferences"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-samples`}>Previous writing samples</Label>
        <Textarea
          id={`${id}-samples`}
          value={values.samples}
          maxLength={300200}
          rows={6}
          onChange={(event) => change('samples', event.target.value)}
          placeholder="Paste previous writing. Separate samples with ===SAMPLE==="
        />
        <p className="text-sm text-muted-foreground">
          Up to ten samples, each at most 30,000 characters. Samples set
          baseline voice and structure; draft feedback takes precedence.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-provider`}>Generation runtime</Label>
          <select
            required
            className="h-9 rounded-md border bg-background px-3 text-sm"
            id={`${id}-provider`}
            value={values.provider}
            onChange={(event) =>
              setDirty((current) => ({
                ...current,
                provider: event.target.value,
                model: '',
                context: '',
              }))
            }
          >
            <option value="">Choose a runtime</option>
            <option value="openai">Hosted OpenAI</option>
            <option value="codex-cli">Local Codex CLI</option>
            <option value="claude-code">Local Claude Code</option>
            <option value="ollama">Local Ollama</option>
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-model`}>Model</Label>
          <Input
            required
            maxLength={200}
            id={`${id}-model`}
            value={values.model}
            onChange={(event) => change('model', event.target.value)}
            placeholder="Configured provider model"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-context`}>Context window (tokens)</Label>
          <Input
            type="number"
            min={8192}
            max={2000000}
            id={`${id}-context`}
            value={values.context}
            onChange={(event) => change('context', event.target.value)}
            placeholder="Discovered when available"
          />
          <p className="text-xs text-muted-foreground">
            Required for custom models whose limit cannot be discovered.
          </p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Local work runs as the person who saves these settings, while their
        local worker is active. Other editors can choose hosted generation.
        Queued jobs keep their chosen runtime. Weak themes need configured Exa
        research.
      </p>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Evidence and research settings
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor={`${id}-age`}>Evidence half-life (days)</Label>
            <Input
              required
              min={1}
              max={730}
              type="number"
              id={`${id}-age`}
              value={values.halfLife}
              onChange={(event) =>
                change('halfLife', Number(event.target.value))
              }
            />
          </div>
          <div>
            <Label htmlFor={`${id}-minutes`}>Research limit (minutes)</Label>
            <Input
              required
              min={1}
              max={10}
              type="number"
              id={`${id}-minutes`}
              value={values.minutes}
              onChange={(event) =>
                change('minutes', Number(event.target.value))
              }
            />
          </div>
          <div>
            <Label htmlFor={`${id}-pages`}>New page limit</Label>
            <Input
              required
              min={1}
              max={30}
              type="number"
              id={`${id}-pages`}
              value={values.pages}
              onChange={(event) => change('pages', Number(event.target.value))}
            />
          </div>
        </div>
      </details>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.enabled}
          onChange={(event) => change('enabled', event.target.checked)}
        />
        Prepare themes automatically after published reports
      </label>
      <p className="text-xs text-muted-foreground">
        Enabling automation prepares recent reports. Later saves update
        settings. Existing jobs finish after automation is disabled; manual
        preparation and drafting remain available.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Saving…' : 'Save newsletter settings'}
      </Button>
    </form>
  );
}
