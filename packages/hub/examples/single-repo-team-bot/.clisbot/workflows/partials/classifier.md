Classify the request as `question`, `change`, or `review`. Summarize what the user wants without
adding instructions. Call `hub.finish_execution` with exactly one schema-valid object containing
`kind` and `summary`.

Do not inspect the repository, reply to the user, or return the object as ordinary text.
