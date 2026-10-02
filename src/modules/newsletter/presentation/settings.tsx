import { useId, useState } from 'react';

import { Button } from '@/platform/components/ui/button';
import { Input } from '@/platform/components/ui/input';
import { Label } from '@/platform/components/ui/label';
import { Textarea } from '@/platform/components/ui/textarea';

import type { NewsletterProfile } from '../domain/newsletter';

export function NewsletterSettings({
  profile,
  audienceSuggestion,
  onSave,
  pending,
}: {
  profile: NewsletterProfile | null;
  audienceSuggestion: string;
  onSave: (profile: NewsletterProfile) => void;
  pending: boolean;
}) {
  const id = useId();
  const [audience, setAudience] = useState(
    profile?.audience ?? audienceSuggestion
  );
  const [guidance, setGuidance] = useState(profile?.guidance ?? '');
  const [samples, setSamples] = useState(
    profile?.samples.join('\n===SAMPLE===\n') ?? ''
  );
  const [provider, setProvider] = useState(profile?.runtime.provider ?? '');
  const [model, setModel] = useState(profile?.runtime.model ?? '');
  const [enabled, setEnabled] = useState(profile?.enabled ?? true);
  const [halfLife, setHalfLife] = useState(profile?.halfLifeDays ?? 90);
  const [minutes, setMinutes] = useState(profile?.researchMinutes ?? 5);
  const [pages, setPages] = useState(profile?.researchPages ?? 10);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!provider) return;
        onSave({
          audience,
          guidance,
          samples: samples
            .split('===SAMPLE===')
            .map((s) => s.trim())
            .filter(Boolean),
          enabled,
          halfLifeDays: halfLife,
          researchMinutes: minutes,
          researchPages: pages,
          runtime: {
            mode: provider === 'openai' ? 'hosted' : 'local',
            provider: provider as NewsletterProfile['runtime']['provider'],
            model,
          },
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-audience`}>Newsletter readership</Label>
        <Textarea
          required
          maxLength={4000}
          id={`${id}-audience`}
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-guidance`}>House writing guidance</Label>
        <Textarea
          maxLength={12000}
          id={`${id}-guidance`}
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder="Voice, structure, length, terminology, and editorial preferences"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-samples`}>Previous writing samples</Label>
        <Textarea
          id={`${id}-samples`}
          value={samples}
          onChange={(e) => setSamples(e.target.value)}
          rows={6}
          placeholder="Paste previous writing. Separate samples with ===SAMPLE==="
        />
        <p className="text-sm text-muted-foreground">
          Samples set the baseline voice and structure. Draft-specific feedback
          takes precedence. Provide guidance or a sample before drafting.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-provider`}>Generation runtime</Label>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            id={`${id}-provider`}
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setModel('');
            }}
            required
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
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Configured provider model"
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Local work stays queued until the local app is running. Hosted
        generation uses the configured API credentials. Weak themes need
        configured Exa public research.
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
              id={`${id}-age`}
              type="number"
              value={halfLife}
              onChange={(e) => setHalfLife(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-minutes`}>Research limit (minutes)</Label>
            <Input
              required
              min={1}
              max={10}
              id={`${id}-minutes`}
              type="number"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-pages`}>New page limit</Label>
            <Input
              required
              min={1}
              max={30}
              id={`${id}-pages`}
              type="number"
              value={pages}
              onChange={(e) => setPages(Number(e.target.value))}
            />
          </div>
        </div>
      </details>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Prepare themes automatically after published reports
      </label>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Saving…' : 'Save newsletter settings'}
      </Button>
    </form>
  );
}
