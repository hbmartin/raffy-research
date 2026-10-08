import { parseArgs } from 'node:util';

export const COMMANDS: Record<string, string[]> = {
  'auth login': ['name', 'capabilities', 'base-url', 'no-open'],
  'auth whoami': [],
  'auth list': [],
  'auth revoke': ['id'],
  'auth logout': [],
  'doctor check': [],
  'worker start': [],
  'worker status': [],
  'worker stop': [],
  'worker run': [],
  'research workspaces': [],
  'research workspace': ['id'],
  'research reports': [],
  'research history': [],
  'research latest': [],
  'research report': ['report', 'section'],
  'research captures': ['source'],
  'research judgment': ['id'],
  'research sources': ['report', 'query'],
  'research search': ['query', 'kind'],
  'research source': ['source', 'content'],
  'research evidence': ['report', 'source'],
  'research discover': ['query', 'pages', 'key'],
  'research label': [
    'source',
    'label',
    'rationale',
    'agent',
    'model',
    'prompt-version',
  ],
  'research judgments': ['target'],
  'research recommend': [
    'report',
    'input',
    'agent',
    'model',
    'prompt-version',
    'rationale',
  ],
  'research score': ['report', 'input', 'human'],
  'research promote': ['id', 'human'],
  'newsletter settings': [],
  'newsletter configure': ['input', 'key'],
  'newsletter prepare': ['key'],
  'newsletter offers': [],
  'newsletter angle': ['angle'],
  'newsletter select': ['report', 'angle', 'override-reason', 'replace', 'key'],
  'newsletter skip-angle': ['report', 'angle', 'unskip'],
  'newsletter skip': ['report', 'unskip'],
  'newsletter regenerate': ['selection', 'feedback', 'key'],
  'newsletter abandon': ['selection'],
  'newsletter correct': ['topic', 'action', 'target', 'title', 'source-ids'],
  'newsletter reviews': [],
  'newsletter review': ['review', 'action'],
  'newsletter history': [],
  'newsletter detail': ['id'],
  'newsletter export': ['id', 'out'],
  'pipeline ingest': ['key'],
  'pipeline generate': ['key', 'model', 'period'],
  'lab summarize': ['key', 'source-ids', 'provider', 'model', 'period'],
  'lab generate': ['key', 'source-ids', 'provider', 'model', 'period'],
  'lab evaluate': ['key', 'report', 'provider', 'model'],
  'lab workflow': ['key', 'source-ids', 'provider', 'model', 'period'],
  'operations list': [],
  'operations status': ['id'],
  'operations results': ['id'],
  'operations diagnostics': ['id', 'stage', 'job'],
  'operations cancel': ['id'],
  'operations retry': ['id', 'key', 'acknowledge-uncertainty'],
};
const BOOLEANS = new Set([
  'no-open',
  'content',
  'human',
  'replace',
  'unskip',
  'acknowledge-uncertainty',
]);
export type CliCommand = {
  group: string;
  command: string;
  options: Record<string, string | boolean | undefined>;
};
export function parseCommand(argv: string[]): CliCommand {
  const normalized =
    argv[0] === 'doctor' && argv[1]?.startsWith('--')
      ? [argv[0], 'check', ...argv.slice(1)]
      : argv;
  const [group, command, ...args] = normalized;
  const name = `${group} ${command ?? (group === 'doctor' ? 'check' : '')}`;
  const allowed = COMMANDS[name];
  if (!allowed) throw new Error('Unknown command. Run pnpm raffy --help.');
  const options = Object.fromEntries(
    [...allowed, 'workspace', 'profile', 'limit', 'cursor'].map((key) => [
      key,
      { type: BOOLEANS.has(key) ? ('boolean' as const) : ('string' as const) },
    ])
  );
  const parsed = parseArgs({
    args,
    options,
    strict: true,
    allowPositionals: false,
  });
  return { group: group!, command: command ?? 'check', options: parsed.values };
}
export const help = () => ({
  type: 'cli_help',
  version: 1,
  commands: Object.entries(COMMANDS).map(([command, flags]) => ({
    command: `pnpm raffy ${command}`,
    flags,
    commonFlags: ['workspace', 'profile', 'limit', 'cursor'],
  })),
});
