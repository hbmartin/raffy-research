import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { match } from 'ts-pattern';

import {
  type MarkdownNode,
  markdownNodeUrl,
  type ParsedMarkdown,
  parseMarkdown,
} from '../domain/markdown';

function render(
  node: MarkdownNode,
  document: ParsedMarkdown,
  key: string
): ReactNode {
  const children = node.children?.map((child, index) =>
    render(child, document, `${key}:${index}`)
  );
  return match(node.type)
    .with('html', 'definition', 'image', 'imageReference', () => null)
    .with('text', () => node.value)
    .with('link', 'linkReference', () => {
      const url = markdownNodeUrl(node, document);
      return url && /^https?:\/\//i.test(url) ? (
        <a
          key={key}
          className="text-primary underline"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      ) : (
        children
      );
    })
    .with('paragraph', () => (
      <p key={key} className="mb-3">
        {children}
      </p>
    ))
    .with('heading', () => (
      <h4 key={key} className="my-3 font-semibold">
        {children}
      </h4>
    ))
    .with('strong', () => <strong key={key}>{children}</strong>)
    .with('emphasis', () => <em key={key}>{children}</em>)
    .with('inlineCode', () => <code key={key}>{node.value}</code>)
    .with('code', () => (
      <pre key={key} className="overflow-auto whitespace-pre-wrap">
        <code>{node.value}</code>
      </pre>
    ))
    .with('break', () => <br key={key} />)
    .with('blockquote', () => (
      <blockquote key={key} className="border-l-2 pl-3">
        {children}
      </blockquote>
    ))
    .with('list', () =>
      node.ordered ? (
        <ol key={key} className="list-inside list-decimal">
          {children}
        </ol>
      ) : (
        <ul key={key} className="list-inside list-disc">
          {children}
        </ul>
      )
    )
    .with('listItem', () => <li key={key}>{children}</li>)
    .with('thematicBreak', () => <hr key={key} />)
    .otherwise(() => children);
}
export function ArticlePreview({ markdown }: { markdown: string }) {
  const document = useMemo(() => parseMarkdown(markdown), [markdown]);
  return (
    <div className="text-sm leading-relaxed break-words">
      {render(document.root, document, 'article')}
    </div>
  );
}
