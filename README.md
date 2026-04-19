# paperclip-graphiti-mcp

Paperclip plugin that bridges a [Graphiti](https://github.com/getzep/graphiti) knowledge graph MCP server into [Paperclip](https://github.com/paperclipai/paperclip) agent tools.

Every agent in your Paperclip company gets 5 tools to search, store, and retrieve knowledge from a Graphiti-powered memory graph.

## Prerequisites

- **Paperclip** >= 2026.416.0
- **Graphiti MCP server** running with Streamable HTTP transport (the `zepai/knowledge-graph-mcp` Docker image or equivalent)
- **FalkorDB** instance (backing store for Graphiti)

### Typical Graphiti stack (Docker)

```yaml
# docker-compose.yml
services:
  falkordb:
    image: falkordb/falkordb:latest
    ports:
      - "6379:6379"
      - "3000:3000"   # browser UI

  graphiti-mcp:
    image: zepai/knowledge-graph-mcp:latest
    ports:
      - "8000:8000"
    environment:
      - NEO4J_URI=bolt://falkordb:6379
      - OPENAI_API_KEY=sk-...        # for embeddings
      - MODEL_NAME=gpt-4.1-mini      # for entity extraction
      - EMBEDDING_MODEL=text-embedding-3-small
      - GROUP_ID=default
```

## Install

```bash
# Clone
git clone https://github.com/rstan251/paperclip-graphiti-mcp.git
cd paperclip-graphiti-mcp

# Install dependencies
npm install

# Install into Paperclip
paperclipai plugin install --local .
```

Verify:

```bash
paperclipai plugin list
# key=irt.graphiti-mcp  status=ready  version=1.0.0
```

## Configuration

After install, configure via the Paperclip CLI:

```bash
paperclipai plugin config irt.graphiti-mcp --set mcpServerUrl=http://localhost:8000/mcp
paperclipai plugin config irt.graphiti-mcp --set defaultGroupId=my-graph
```

| Key | Default | Description |
|-----|---------|-------------|
| `mcpServerUrl` | `http://localhost:8000/mcp` | Graphiti MCP server URL (Streamable HTTP) |
| `defaultGroupId` | `nbos` | Default `group_id` for all memory operations |

## Tools

Once installed, all Paperclip agents (CEO, engineers, librarian, etc.) get these tools:

### `search_memory`

Search for entities (people, systems, clients, projects) by natural language query. Maps to Graphiti's `search_nodes`.

```
query: "Mac Mini infrastructure"    (required)
group_ids: ["nbos"]                 (optional, defaults to config)
max_nodes: 10                       (optional)
```

### `search_facts`

Search for relationships between entities with temporal metadata. Maps to Graphiti's `search_memory_facts`.

```
query: "what services run on port 3100"   (required)
group_ids: ["nbos"]                        (optional)
max_facts: 10                              (optional)
```

### `add_memory`

Store new information. Graphiti automatically extracts entities and relationships from the content.

```
name: "Paperclip upgrade to 2026.416.0"   (required)
episode_body: "Updated Paperclip from..."  (required)
group_id: "nbos"                           (optional)
source: "ceo-agent"                        (optional)
source_description: "CEO session notes"    (optional)
```

### `get_status`

Returns graph health: node count, edge count, connection status.

### `get_episodes`

Retrieve recently stored episodes (raw content snapshots).

```
group_ids: ["nbos"]   (optional)
max_episodes: 10      (optional)
```

## Architecture

```
Paperclip Agent
  └─ calls tool (e.g. search_memory)
      └─ Plugin Worker (worker.js)
          └─ JSON-RPC 2.0 over Streamable HTTP
              └─ Graphiti MCP Server (:8000)
                  └─ FalkorDB (:6379)
```

The plugin handles:
- **MCP session management** — initializes session on first call, caches the session ID, retries on expiry
- **SSE response parsing** — Graphiti MCP returns Server-Sent Events format; the plugin extracts JSON from `data:` lines
- **Tool name mapping** — Paperclip tool names map to Graphiti MCP tool names (`search_memory` -> `search_nodes`, `search_facts` -> `search_memory_facts`)

## File Structure

```
paperclip-graphiti-mcp/
├── package.json       # Plugin metadata, type:module, paperclipPlugin entry
├── manifest.cjs       # Plugin manifest (CJS — required by Paperclip's import())
├── worker.js          # Plugin worker (ESM — runs as child process)
└── README.md
```

**Why is the manifest CJS?** Paperclip's plugin loader uses dynamic `import()` on the manifest file. When `package.json` has `"type": "module"`, the manifest must be `.cjs` to be loaded as CommonJS via `module.exports`. The worker runs as a separate child process and works fine as ESM.

## Plugin Manifest Reference

The manifest declares the plugin's identity, capabilities, and tools to Paperclip:

| Field | Value | Notes |
|-------|-------|-------|
| `id` | `irt.graphiti-mcp` | Unique plugin identifier |
| `apiVersion` | `1` | Paperclip plugin API version (must be literal `1`) |
| `categories` | `["connector"]` | Valid: `connector`, `workspace`, `automation`, `ui` |
| `capabilities` | `agent.tools.register`, `http.outbound`, `plugin.state.read` | Permissions the plugin needs |

## Updating

To update the plugin after code changes:

```bash
paperclipai plugin uninstall irt.graphiti-mcp
paperclipai plugin install --local /path/to/paperclip-graphiti-mcp
```

Or restart Paperclip if the module cache is stale:

```bash
launchctl unload ~/Library/LaunchAgents/com.nbos.paperclip.plist
launchctl load ~/Library/LaunchAgents/com.nbos.paperclip.plist
paperclipai plugin install --local /path/to/paperclip-graphiti-mcp
```

## Deployment Notes (IRT)

Production deployment on `ssh mini` (bertos-mac-mini):

- **Plugin path:** `/Users/bertostanley/plugins/graphiti-mcp/`
- **Graphiti MCP:** `http://localhost:8000/mcp` (container: `graphiti-mcp`)
- **FalkorDB:** `localhost:6379` (container: `graphiti-falkordb`)
- **Graph name:** `nbos`
- **Content:** 310+ memory files ingested, covering infrastructure, clients, products, session history
- **Paperclip:** `http://localhost:3100` (LaunchAgent: `com.nbos.paperclip`)

## License

MIT
