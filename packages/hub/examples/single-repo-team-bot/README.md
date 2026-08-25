# Single-repository team bot

Run a Codex classifier and worker from Discord, Slack, or GitHub. Every step gets an isolated
worktree based on `origin/main`.

## Configure the example

Copy `.paseo` to your repository root, then replace these values:

| Placeholder                         | Value                                    |
| ----------------------------------- | ---------------------------------------- |
| `your-daemon`                       | The daemon slug shown in Hub             |
| `/absolute/path/to/your/repository` | Repository checkout on that daemon       |
| `your-org/your-repo`                | GitHub repository allowed for the worker |
| `your-github-connection`            | GitHub connection slug in Hub            |
| `YOUR_DISCORD_USER_ID`              | Discord user allowed to trigger runs     |
| `YOUR_SLACK_USER_ID`                | Slack user allowed to trigger runs       |
| `your-github-login`                 | GitHub user allowed to trigger runs      |
| `@your-bot`                         | Mention that starts the GitHub workflow  |

Connect Discord, Slack, and GitHub to the project before enabling their triggers. Keep the user
allowlists narrow; wildcards are not supported.

## Deploy

From the repository root:

```sh
paseo hub deploy -p your-project --dry-run
paseo hub deploy -p your-project
```

The classifier labels the request without write access. The worker receives the original prompt,
the classification, and the triggering conversation context. Its GitHub token is limited to the
configured repository and permissions for one hour.

See the [Hub documentation](https://paseo.sh/docs/hub) for provider setup and configuration
reference.
