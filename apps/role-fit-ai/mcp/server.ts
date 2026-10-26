// RoleFit's local MCP server: newline-delimited JSON-RPC 2.0 over stdio, the
// MCP stdio transport. It implements only what tool use needs (initialize,
// tools/list, tools/call, ping, and cancellation), so it carries no SDK
// dependency. stdout is the protocol stream; diagnostics go to stderr.
//
//   node apps/role-fit-ai/mcp/server.ts        (ROLEFIT_URL=http://127.0.0.1:5181)

import { createInterface } from "node:readline";

import { roleFitBaseUrl, type Tool } from "./client.ts";
import { createTools } from "./tools.ts";

// Newest first; a client asking for another version is offered the newest.
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "rolefit", title: "RoleFit", version: "1.1.0" };
const INSTRUCTIONS =
  "Records job applications in the user's local RoleFit tracker and runs RoleFit's AI stages. Search before " +
  "committing to avoid duplicates; get_application reads one in full and get_submission_package everything saved " +
  "for it; commit_application saves a whole application (with its resume) or a Draft atomically, refuses " +
  "unacknowledged duplicates, and validates without saving on dryRun; update_application_status moves its stage " +
  "and submits a Draft with its documents; add_application_answers adds answers; log_application_event records " +
  "interviews, responses and follow-ups. The list_/get_ tools read saved resumes, cover letters, answers and the " +
  "user's Profile. analyze_job, assess_fit, polish_resume, polish_cover_letter, draft_answer and " +
  "review_application run the provider set in RoleFit (billed or CLI; minutes; cancel to stop) and save nothing.";

type JsonRpcId = string | number | null;
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string } };

const failure = (id: JsonRpcId, code: number, message: string): JsonRpcResponse =>
  ({ jsonrpc: "2.0", id, error: { code, message } });

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

// One message in, at most one response out (notifications get none).
export async function handleMcpMessage(message: unknown, tools: Tool[], signal?: AbortSignal): Promise<JsonRpcResponse | null> {
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
      const { ok, value } = await tool.run(args, signal);
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
  // Requests run concurrently, so a minutes-long AI call never holds up the
  // rest; each reply carries its request id. A cancelled call is aborted, which
  // stops RoleFit's provider run, and gets no reply; so does every open call
  // when the client goes away.
  const running = new Map<string | number, AbortController>();
  const pending = new Set<Promise<void>>();
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      write(failure(null, -32700, "Parse error."));
      return;
    }
    if (isObject(message) && message.jsonrpc === "2.0" && message.method === "notifications/cancelled") {
      const requestId = isObject(message.params) ? message.params.requestId : undefined;
      if (typeof requestId === "string" || typeof requestId === "number") running.get(requestId)?.abort();
      return;
    }
    const id = isObject(message) && (typeof message.id === "string" || typeof message.id === "number") ? message.id : undefined;
    const controller = new AbortController();
    if (id !== undefined) running.set(id, controller);
    const task = (async () => {
      try {
        const response = await handleMcpMessage(message, tools, controller.signal);
        if (!controller.signal.aborted) write(response);
      } catch (error) {
        process.stderr.write(`rolefit-mcp: ${error instanceof Error ? error.name : "error"} while handling a request\n`);
        if (id !== undefined && !controller.signal.aborted) write(failure(id, -32603, "Internal error."));
      } finally {
        if (id !== undefined && running.get(id) === controller) running.delete(id);
      }
    })();
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  return new Promise((resolve) => {
    lines.on("close", () => {
      for (const controller of running.values()) controller.abort();
      void Promise.all(pending).then(() => resolve());
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
