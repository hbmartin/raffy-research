import { fromMarkdown } from 'mdast-util-from-markdown';

export type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  url?: string;
  identifier?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
};
export type ParsedMarkdown = {
  root: MarkdownNode;
  definitions: Map<string, string>;
};
export function parseMarkdown(markdown: string): ParsedMarkdown {
  const root: MarkdownNode = fromMarkdown(markdown);
  const definitions = new Map<string, string>();
  const visit = (node: MarkdownNode) => {
    if (node.type === 'definition' && node.identifier && node.url)
      definitions.set(node.identifier.toUpperCase(), node.url);
    node.children?.forEach(visit);
  };
  visit(root);
  return { root, definitions };
}
export function markdownNodeUrl(
  node: MarkdownNode,
  document: ParsedMarkdown
): string | undefined {
  return (
    node.url ??
    (node.identifier
      ? document.definitions.get(node.identifier.toUpperCase())
      : undefined)
  );
}
export function markdownLinks(markdown: string): string[] {
  const document = parseMarkdown(markdown),
    urls: string[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === 'link' || node.type === 'linkReference') {
      const url = markdownNodeUrl(node, document);
      if (url) urls.push(url);
    }
    node.children?.forEach(visit);
  };
  visit(document.root);
  return urls;
}
export function markdownText(markdown: string): string {
  const document = parseMarkdown(markdown);
  const render = (node: MarkdownNode): string => {
    if (node.type === 'html' || node.type === 'definition') return '';
    const value = node.value ?? node.children?.map(render).join('') ?? '';
    if (node.type === 'link' || node.type === 'linkReference') {
      const url = markdownNodeUrl(node, document);
      return url ? `${value} (${url})` : value;
    }
    if (node.type === 'image' || node.type === 'imageReference') return '';
    if (
      ['paragraph', 'heading', 'blockquote', 'list', 'code'].includes(node.type)
    )
      return `${value}\n\n`;
    if (node.type === 'listItem') return `- ${value.trim()}\n`;
    if (node.type === 'break') return '\n';
    return value;
  };
  return render(document.root).trim();
}
