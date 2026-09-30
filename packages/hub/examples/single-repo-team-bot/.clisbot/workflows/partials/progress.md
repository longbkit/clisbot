Only call `hub.reply` to send user-facing messages to the originating conversation. For a simple
question, call it with the answer and no progress message. For substantial work, first call it with
one sentence describing what you will do.

When you create a pull request, immediately call `hub.reply` with its URL. If the user asked you to
babysit its checks, call `hub.reply` again when they pass or when a specific failure blocks the work.
