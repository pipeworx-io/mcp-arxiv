interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * arXiv MCP — preprint server search (free, no auth)
 *
 * Atom-feed API: https://info.arxiv.org/help/api/user-manual.html
 * Tools:
 * - search_papers: full-text/field search (supports prefixes au:, ti:, abs:, cat:, all:)
 * - get_paper:     fetch a single paper by arXiv ID (e.g., "2310.06825" or "cs.CL/0301001")
 */


const BASE_URL = 'https://export.arxiv.org/api/query';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_papers',
    description:
      'Search arXiv preprints. Plain text searches all fields; use prefixes for targeted queries: au:hinton (author), ti:transformer (title), abs:diffusion (abstract), cat:cs.AI (category), all:quantum (any field). Combine with AND/OR/ANDNOT, e.g., "ti:transformer AND cat:cs.LG". Returns id, title, authors, abstract, categories, published date, PDF URL.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Query string. Plain text or field-prefixed (au:, ti:, abs:, cat:, all:). Combine terms with AND, OR, ANDNOT.',
        },
        max_results: {
          type: 'number',
          description: 'Maximum papers to return (1-100, default 10)',
        },
        sort_by: {
          type: 'string',
          description: 'relevance | lastUpdatedDate | submittedDate (default relevance)',
          enum: ['relevance', 'lastUpdatedDate', 'submittedDate'],
        },
        sort_order: {
          type: 'string',
          description: 'ascending | descending (default descending)',
          enum: ['ascending', 'descending'],
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_paper',
    description:
      'Fetch a single arXiv paper by its ID (e.g., "2310.06825", "2310.06825v2", or legacy "cs.CL/0301001"). Returns full metadata: title, authors, abstract, categories, DOI (if linked), PDF URL.',
    inputSchema: {
      type: 'object',
      properties: {
        arxiv_id: { type: 'string', description: 'arXiv identifier (with or without version suffix)' },
      },
      required: ['arxiv_id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_papers':
      return searchPapers(
        args.query as string,
        (args.max_results as number) ?? 10,
        (args.sort_by as string) ?? 'relevance',
        (args.sort_order as string) ?? 'descending',
      );
    case 'get_paper':
      return getPaper(args.arxiv_id as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function searchPapers(
  query: string,
  maxResults: number,
  sortBy: string,
  sortOrder: string,
) {
  const params = new URLSearchParams({
    search_query: query,
    max_results: String(Math.min(100, Math.max(1, maxResults))),
    sortBy,
    sortOrder,
  });

  const res = await fetch(`${BASE_URL}?${params}`);
  if (!res.ok) throw new Error(`arXiv error: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  return { total_results: parseTotalResults(xml), results: parseEntries(xml) };
}

async function getPaper(arxivId: string) {
  // Strip any version suffix like "v2" — id_list accepts both, but normalize for cache hits
  const cleanId = arxivId.trim();
  if (!cleanId) throw new Error('arxiv_id is required');
  const params = new URLSearchParams({ id_list: cleanId, max_results: '1' });

  const res = await fetch(`${BASE_URL}?${params}`);
  if (!res.ok) throw new Error(`arXiv error: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  const entries = parseEntries(xml);
  if (entries.length === 0) {
    throw new Error(`No paper found for arxiv_id: ${arxivId}`);
  }
  return entries[0];
}

// ── Atom parsing ─────────────────────────────────────────────────────
// arXiv's Atom output is stable and well-formed; a tight regex parser
// avoids pulling in a DOM/XML dep just for this pack.

interface ParsedEntry {
  arxiv_id: string;
  title: string;
  summary: string;
  authors: string[];
  categories: string[];
  primary_category: string | null;
  published: string;
  updated: string;
  pdf_url: string | null;
  abs_url: string | null;
  doi: string | null;
  journal_ref: string | null;
  comment: string | null;
}

function parseTotalResults(xml: string): number {
  const m = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
  return m ? Number(m[1]) : 0;
}

function parseEntries(xml: string): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const body = m[1];
    const idUrl = pickTag(body, 'id') ?? '';
    const arxivId = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, '');

    const authors: string[] = [];
    const authorRe = /<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g;
    let a: RegExpExecArray | null;
    while ((a = authorRe.exec(body)) !== null) authors.push(decode(a[1].trim()));

    const categories: string[] = [];
    const catRe = /<category[^>]*term="([^"]+)"/g;
    let c: RegExpExecArray | null;
    while ((c = catRe.exec(body)) !== null) categories.push(c[1]);

    const primary = body.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1] ?? null;
    const pdfLink = body.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/)?.[1] ?? null;
    const absLink = body.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1] ?? null;

    out.push({
      arxiv_id: arxivId,
      title: collapse(decode(pickTag(body, 'title') ?? '')),
      summary: collapse(decode(pickTag(body, 'summary') ?? '')),
      authors,
      categories,
      primary_category: primary,
      published: pickTag(body, 'published') ?? '',
      updated: pickTag(body, 'updated') ?? '',
      pdf_url: pdfLink,
      abs_url: absLink,
      doi: pickTag(body, 'arxiv:doi'),
      journal_ref: pickTag(body, 'arxiv:journal_ref'),
      comment: pickTag(body, 'arxiv:comment'),
    });
  }
  return out;
}

function pickTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
