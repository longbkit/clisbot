/** The plane's one-line notices instead of silence: a message waiting for a
 * limit, a Host or a session, and one the durable queue gave up on. */
export const WAIT_NOTICE_TEXT = {
  queued: "Busy right now. Your message is queued and runs when there is room.",
  "too-long": "This message is longer than this bot accepts. Shorten it and send it again.",
  starting: "Starting a session for you. This can take a minute.",
  "host-away":
    "The machine that runs this bot is not connected right now. Your message is queued and runs when it is back.",
  unprocessed:
    "This message could not be processed. Send another message to retry, and this one will be included.",
  refused: "This message could not be processed. Send it again.",
  "outcome-unknown":
    "Processing stopped before its outcome could be confirmed. It was not retried automatically. Check the session before sending this message again.",
  // Part of a turn's stream never reached the Hub (a socket gap, or a
  // subscription lost while the socket stayed up): what the thread shows may
  // not be the whole reply. Says no cause it cannot know, and resends nothing.
  "reply-unconfirmed":
    "This bot could not confirm that the complete reply reached this thread. Check the session for the full result. Nothing was sent again automatically.",
  // A turn the Host took with it: its terminal event never comes.
  "host-lost":
    "The machine that runs this bot went away while it was working on this message, so an answer may never come. Send it again if you do not get one.",
} as const;
