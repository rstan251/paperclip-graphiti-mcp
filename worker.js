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

    ctx.logger.info("Graphiti MCP plugin ready — 5 tools registered");
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
