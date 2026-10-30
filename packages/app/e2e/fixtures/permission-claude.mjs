// Synthetic Claude transport for approval UI tests. No account, inference or command execution.
import readline from "node:readline";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const sessionId = "synthetic-approval-session";
let currentMode = "bypassPermissions";
if (process.argv.includes("--version")) {
  console.log("2.1.0 (Claude Code)");
} else {
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.type === "control_request") {
      const subtype = message.request.subtype;
      if (subtype === "set_permission_mode") currentMode = message.request.mode;
      send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: message.request_id,
          response:
            subtype === "initialize"
              ? {
                  commands: [],
                  agents: [],
                  models: [{ value: "synthetic", displayName: "Synthetic" }],
                }
              : {},
        },
      });
    }
    if (message.type === "user") {
      const prompt = JSON.stringify(message.message.content);
      const legacy = prompt.includes("legacy");
      const blank = prompt.includes("blank-context");
      const long = prompt.includes("long-context");
      send({
        type: "system",
        subtype: "init",
        session_id: sessionId,
        model: "synthetic",
        permissionMode: currentMode,
        tools: [],
        mcp_servers: [],
      });
      send({
        type: "control_request",
        request_id: "synthetic-approval",
        request: {
          subtype: "can_use_tool",
          tool_name: "Bash",
          tool_use_id: "synthetic-tool",
          input: { command: "printf synthetic" },
          ...(!legacy
            ? {
                decision_reason:
                  (blank ? "   " : "Synthetic policy requires approval for this path.") +
                  (long ? " Review the protected destination before continuing.".repeat(12) : ""),
                blocked_path:
                  (blank ? "   " : "/synthetic/protected/") +
                  (long ? "very-long-segment-".repeat(20) : "") +
                  (blank ? "" : "config.json"),
              }
            : {}),
        },
      });
    }
    if (
      message.type === "control_response" &&
      message.response.request_id === "synthetic-approval"
    ) {
      send({
        type: "result",
        subtype: "success",
        session_id: sessionId,
        result: "Synthetic request resolved.",
        is_error: false,
        duration_ms: 1,
        duration_api_ms: 0,
        num_turns: 1,
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    }
  });
}
