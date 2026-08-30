// One-shot Slack Web API post with the configured USER credential.
// Usage: node .writer-progress/slack-post.mjs <channel> <text> [thread_ts]
// Prints the posted ts. Never prints token values.
const channel = process.argv[2];
const text = process.argv[3];
const threadTs = process.argv[4];
if (!channel || !text) {
  console.error("usage: slack-post.mjs <channel> <text> [thread_ts]");
  process.exit(2);
}
const body = { channel, text };
if (threadTs) body.thread_ts = threadTs;
const res = await fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer " + process.env.SLACK_MCP_XOXP_TOKEN,
  },
  body: JSON.stringify(body),
});
const j = await res.json();
if (!j.ok) {
  console.error("FAIL", j.error, j.message);
  process.exit(1);
}
console.log(j.ts);
