#!/usr/bin/env node
/**
 * Simple MCP Server — returns current time.
 * Uses official @modelcontextprotocol/sdk
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "simple-time-server",
  version: "1.0.0",
});

server.tool(
  "get_current_time",
  "Returns the current date and time in ISO format",
  {},
  async () => ({
    content: [{ type: "text", text: new Date().toISOString() }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
