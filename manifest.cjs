module.exports = {
  id: "irt.graphiti-mcp",
  apiVersion: 1,
  version: "1.1.0",
  displayName: "Graphiti Knowledge Graph",
  description: "Query and store memories in the Graphiti knowledge graph. Gives all agents access to IRT institutional knowledge.",
  author: "Iron Noodle Technologies",
  categories: ["connector"],
  capabilities: [
    "agent.tools.register",
    "http.outbound",
    "plugin.state.read",
  ],
  entrypoints: {
    worker: "./worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      mcpServerUrl: { type: "string" },
      defaultGroupId: { type: "string" },
    },
  },
  tools: [
    {
      name: "search_memory",
      displayName: "Search Memory",
      description: "Search the IRT knowledge graph for entities.",
      parametersSchema: { type: "object", properties: { query: { type: "string" }, group_ids: { type: "array", items: { type: "string" } }, max_nodes: { type: "number" } }, required: ["query"] },
    },
    {
      name: "search_facts",
      displayName: "Search Facts",
      description: "Search for relationships between entities in the knowledge graph.",
      parametersSchema: { type: "object", properties: { query: { type: "string" }, group_ids: { type: "array", items: { type: "string" } }, max_facts: { type: "number" } }, required: ["query"] },
    },
    {
      name: "add_memory",
      displayName: "Add Memory",
      description: "Store new information in the knowledge graph.",
      parametersSchema: { type: "object", properties: { name: { type: "string" }, episode_body: { type: "string" }, group_id: { type: "string" }, source: { type: "string" }, source_description: { type: "string" } }, required: ["name", "episode_body"] },
    },
    {
      name: "get_status",
      displayName: "Graph Status",
      description: "Get current status of the Graphiti knowledge graph.",
      parametersSchema: { type: "object", properties: {} },
    },
    {
      name: "get_episodes",
      displayName: "Get Recent Episodes",
      description: "Retrieve recent episodes from the knowledge graph.",
      parametersSchema: { type: "object", properties: { group_ids: { type: "array", items: { type: "string" } }, max_episodes: { type: "number" } } },
    },
    {
      name: "route_session",
      displayName: "Route Session to Project",
      description: "Given a session description, find the best matching client/project. Returns the project slug (= Graphiti group_id) or suggests creating a new one.",
      parametersSchema: { type: "object", properties: { description: { type: "string" } }, required: ["description"] },
    },
    {
      name: "register_project",
      displayName: "Register Project",
      description: "Register a new client or project so future sessions can be auto-routed to it.",
      parametersSchema: { type: "object", properties: { slug: { type: "string" }, name: { type: "string" }, client: { type: "string" }, keywords: { type: "array", items: { type: "string" } } }, required: ["slug", "name"] },
    },
    {
      name: "list_projects",
      displayName: "List Projects",
      description: "List all registered client/project scopes available for session routing.",
      parametersSchema: { type: "object", properties: {} },
    },
  ],
};
