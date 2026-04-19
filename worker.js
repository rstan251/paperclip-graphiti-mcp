import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const DEFAULT_MCP_URL = "http://localhost:8000/mcp";
const DEFAULT_GROUP_ID = "nbos";

async function mcpCall(mcpUrl, sessionId, method, params) {
  const resp = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params: params || {},
    }),
  });

  const text = await resp.text();
  const newSessionId = resp.headers.get("mcp-session-id") || sessionId;

  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      const data = JSON.parse(line.slice(6));
      return { result: data.result || data.error, sessionId: newSessionId };
    }
  }

  try {
    const data = JSON.parse(text);
    return { result: data.result || data.error, sessionId: newSessionId };
  } catch {
    return { result: { error: text }, sessionId: newSessionId };
  }
}

const plugin = definePlugin({
  async setup(ctx) {
    const config = await ctx.config.get().catch(() => ({}));
    const mcpUrl = config?.mcpServerUrl || DEFAULT_MCP_URL;
    const defaultGroup = config?.defaultGroupId || DEFAULT_GROUP_ID;

    let sessionId = null;

    async function ensureSession() {
      if (sessionId) return sessionId;
      const resp = await mcpCall(mcpUrl, null, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "paperclip-graphiti", version: "1.0.0" },
      });
      sessionId = resp.sessionId;
      ctx.logger.info("MCP session initialized", { sessionId });
      return sessionId;
    }

    async function callTool(toolName, args) {
      const sid = await ensureSession();
      const resp = await mcpCall(mcpUrl, sid, "tools/call", {
        name: toolName,
        arguments: args,
      });
      if (resp.result?.error?.code === -32600) {
        sessionId = null;
        const sid2 = await ensureSession();
        return (await mcpCall(mcpUrl, sid2, "tools/call", { name: toolName, arguments: args })).result;
      }
      return resp.result;
    }

    function formatResult(result) {
      const content = result?.content || result;
      return {
        content: typeof content === "string" ? content : JSON.stringify(content, null, 2),
        data: result,
      };
    }

    ctx.tools.register(
      "search_memory",
      {
        displayName: "Search Memory",
        description: "Search the knowledge graph for entities",
        parametersSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            group_ids: { type: "array", items: { type: "string" } },
            max_nodes: { type: "number" },
          },
          required: ["query"],
        },
      },
      async (params) => {
        const result = await callTool("search_nodes", {
          query: params.query,
          group_ids: params.group_ids || [defaultGroup],
          max_nodes: params.max_nodes || 10,
        });
        return formatResult(result);
      }
    );

    ctx.tools.register(
      "search_facts",
      {
        displayName: "Search Facts",
        description: "Search for relationships between entities in the knowledge graph",
        parametersSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            group_ids: { type: "array", items: { type: "string" } },
            max_facts: { type: "number" },
          },
          required: ["query"],
        },
      },
      async (params) => {
        const result = await callTool("search_memory_facts", {
          query: params.query,
          group_ids: params.group_ids || [defaultGroup],
          max_facts: params.max_facts || 10,
        });
        return formatResult(result);
      }
    );

    ctx.tools.register(
      "add_memory",
      {
        displayName: "Add Memory",
        description: "Store new information in the knowledge graph",
        parametersSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            episode_body: { type: "string" },
            group_id: { type: "string" },
            source: { type: "string" },
            source_description: { type: "string" },
          },
          required: ["name", "episode_body"],
        },
      },
      async (params) => {
        const result = await callTool("add_memory", {
          name: params.name,
          episode_body: params.episode_body,
          group_id: params.group_id || defaultGroup,
          source: params.source || "paperclip",
          source_description: params.source_description || "Paperclip agent memory",
        });
        return formatResult(result);
      }
    );

    ctx.tools.register(
      "get_status",
      {
        displayName: "Graph Status",
        description: "Get Graphiti knowledge graph status",
        parametersSchema: { type: "object", properties: {} },
      },
      async () => formatResult(await callTool("get_status", {}))
    );

    ctx.tools.register(
      "get_episodes",
      {
        displayName: "Get Recent Episodes",
        description: "Retrieve recent stored content from the knowledge graph",
        parametersSchema: {
          type: "object",
          properties: {
            group_ids: { type: "array", items: { type: "string" } },
            max_episodes: { type: "number" },
          },
        },
      },
      async (params) => {
        const result = await callTool("get_episodes", {
          group_ids: params.group_ids || [defaultGroup],
          max_episodes: params.max_episodes || 10,
        });
        return formatResult(result);
      }
    );

    // --- Session Router ---

    ctx.tools.register(
      "route_session",
      {
        displayName: "Route Session to Project",
        description:
          "Given a session description, find the best matching client/project. " +
          "Returns the project slug (= Graphiti group_id) or suggests creating a new one.",
        parametersSchema: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Session description, issue title, or context to match against known projects",
            },
          },
          required: ["description"],
        },
      },
      async (params) => {
        const result = await callTool("search_nodes", {
          query: params.description,
          group_ids: ["_meta"],
          max_nodes: 5,
        });

        const nodes = result?.content?.[0]?.text
          ? JSON.parse(result.content[0].text)
          : [];

        if (!nodes.length) {
          return formatResult({
            match: null,
            message: "No matching project found. Use register_project to create one.",
            suggestions: [],
          });
        }

        const projects = nodes.map((n) => {
          let meta = {};
          try { meta = JSON.parse(n.summary || "{}"); } catch { meta = { name: n.name }; }
          return {
            slug: meta.slug || n.name?.toLowerCase().replace(/\s+/g, "-"),
            name: meta.name || n.name,
            client: meta.client || null,
            keywords: meta.keywords || [],
            group_id: meta.slug || n.name?.toLowerCase().replace(/\s+/g, "-"),
          };
        });

        return formatResult({
          match: projects[0],
          alternatives: projects.slice(1),
          message: `Best match: ${projects[0].name} (group_id: ${projects[0].group_id})`,
        });
      }
    );

    ctx.tools.register(
      "register_project",
      {
        displayName: "Register Project",
        description:
          "Register a new client or project so future sessions can be auto-routed to it. " +
          "Creates a Graphiti group_id and stores metadata for matching.",
        parametersSchema: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "Short lowercase identifier — becomes the Graphiti group_id (e.g. 'mke', 'aml')",
            },
            name: {
              type: "string",
              description: "Display name (e.g. 'Miller & Miller Law')",
            },
            client: {
              type: "string",
              description: "Primary contact or founder (e.g. 'Jamie Miller')",
            },
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "Matching keywords — practice areas, tech, aliases (e.g. ['bankruptcy', 'milwaukee', 'MKE'])",
            },
          },
          required: ["slug", "name"],
        },
      },
      async (params) => {
        const meta = {
          slug: params.slug.toLowerCase(),
          name: params.name,
          client: params.client || null,
          keywords: params.keywords || [],
          type: "project_registry",
        };

        const episodeBody =
          `Project: ${meta.name} (${meta.slug})\n` +
          `Client: ${meta.client || "N/A"}\n` +
          `Keywords: ${meta.keywords.join(", ")}\n` +
          `Group ID: ${meta.slug}`;

        const result = await callTool("add_memory", {
          name: `project:${meta.slug}`,
          episode_body: episodeBody,
          group_id: "_meta",
          source: "session-router",
          source_description: `Project registry entry for ${meta.name}`,
        });

        return formatResult({
          registered: meta,
          message: `Project "${meta.name}" registered with group_id "${meta.slug}". All agents can now route sessions here.`,
          graphiti_result: result,
        });
      }
    );

    ctx.tools.register(
      "list_projects",
      {
        displayName: "List Projects",
        description: "List all registered client/project scopes available for session routing.",
        parametersSchema: { type: "object", properties: {} },
      },
      async () => {
        const result = await callTool("get_episodes", {
          group_ids: ["_meta"],
          max_episodes: 50,
        });
        return formatResult(result);
      }
    );

    ctx.logger.info("Graphiti MCP plugin ready — 8 tools registered");
  },

  async onHealth() {
    try {
      const resp = await fetch(DEFAULT_MCP_URL.replace("/mcp", "/health"));
      const data = await resp.json();
      return {
        status: data.status === "healthy" ? "ok" : "degraded",
        message: `Graphiti: ${data.status}`,
      };
    } catch (err) {
      return { status: "error", message: `Graphiti unreachable: ${err.message}` };
    }
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
