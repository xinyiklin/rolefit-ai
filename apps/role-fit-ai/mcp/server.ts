// RoleFit's local MCP server: newline-delimited JSON-RPC 2.0 over stdio, the
// MCP stdio transport. It implements only what tool use needs (initialize,
// tools/list, tools/call, ping), so it carries no SDK dependency. stdout is the
// protocol stream; diagnostics go to stderr.
//
//   node apps/role-fit-ai/mcp/server.ts        (ROLEFIT_URL=http://127.0.0.1:5181)

import { createInterface } from "node:readline";

import { createTools, roleFitBaseUrl, type Tool } from "./tools.ts";

// Newest first; a client asking for another version is offered the newest.
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "rolefit", title: "RoleFit tracker", version: "1.0.0" };
const INSTRUCTIONS =
  "Records job applications in the user's local RoleFit tracker. Search before committing to avoid duplicates; " +
  "get_application reads one in full; commit_application saves a whole application or a Draft atomically, " +
  "refuses unacknowledged duplicates, and validates without saving on dryRun; " +
  "add_application_answers adds later answers; log_application_event records interviews, responses and " +
  "follow-ups; update_application_status moves its stage. list_resumes and get_resume read the saved base resumes.";

type JsonRpcId = string | number | null;
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string } };

const failure = (id: JsonRpcId, code: number, message: string): JsonRpcResponse =>
  ({ jsonrpc: "2.0", id, error: { code, message } });

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

// One message in, at most one response out (notifications get none).
export async function handleMcpMessage(message: unknown, tools: Tool[]): Promise<JsonRpcResponse | null> {
  // This server sends no requests, so a client response needs no answer.
  if (isObject(message) && message.jsonrpc === "2.0" && message.method === undefined && ("result" in message || "error" in message)) {
    return null;
  }
  const validId = isObject(message) && (typeof message.id === "string" || typeof message.id === "number");
  if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string" || ("id" in message && !validId)) {
    return failure(validId ? (message as { id: string | number }).id : null, -32600, "Invalid request.");
  }
  if (!("id" in message)) return null;
  const id = message.id as JsonRpcId;
  const params = isObject(message.params) ? message.params : {};
  const result = (value: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result: value });

  switch (message.method) {
    case "initialize": {
      const requested = params.protocolVersion;
      return result({
        protocolVersion: typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS
      });
    }
    case "ping":
      return result({});
    case "tools/list":
      return result({
        tools: tools.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }))
      });
    case "tools/call": {
      const tool = tools.find((candidate) => candidate.name === params.name);
      if (!tool) return failure(id, -32602, `Unknown tool: ${String(params.name)}`);
      const args = isObject(params.arguments) ? params.arguments : {};
      const { ok, value } = await tool.run(args);
      return result({
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
        ...(isObject(value) ? { structuredContent: value } : {}),
        isError: !ok
      });
    }
    default:
      return failure(id, -32601, `Method not found: ${message.method}`);
  }
}

export function serveStdio(tools: Tool[], input = process.stdin, output = process.stdout): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const write = (response: JsonRpcResponse | null) => {
    if (response) output.write(`${JSON.stringify(response)}\n`);
  };
  // One message at a time, in arrival order: replies stay ordered and the
  // RoleFit server serializes tracker writes anyway.
  let queue = Promise.resolve();
  lines.on("line", (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        write(failure(null, -32700, "Parse error."));
        return;
      }
      try {
        write(await handleMcpMessage(message, tools));
      } catch (error) {
        process.stderr.write(`rolefit-mcp: ${error instanceof Error ? error.name : "error"} while handling a request\n`);
        if (isObject(message) && "id" in message) write(failure(message.id as JsonRpcId, -32603, "Internal error."));
      }
    });
  });
  return new Promise((resolve) => {
    lines.on("close", () => {
      void queue.then(resolve);
    });
  });
}

if (import.meta.main) {
  let baseUrl: string;
  try {
    baseUrl = roleFitBaseUrl(process.env.ROLEFIT_URL || undefined);
  } catch (error) {
    process.stderr.write(`rolefit-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
  await serveStdio(createTools(baseUrl));
}
