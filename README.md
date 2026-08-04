# @pipeworx/arxiv

arXiv preprint server MCP — full-text search and paper lookup, no auth.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

- `search_papers(query, max_results?, sort_by?, sort_order?)` — text search; supports field prefixes `au:`, `ti:`, `abs:`, `cat:`, `all:`. Combine with `AND`, `OR`, `ANDNOT`.
- `get_paper(arxiv_id)` — fetch one paper by ID (e.g., `2310.06825`).

## Data source

https://export.arxiv.org/api/query — public Atom-feed endpoint, no key required.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "arxiv": {
      "url": "https://gateway.pipeworx.io/arxiv/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Arxiv data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
