# Owner password and recovery

[User guide](../README.md) · [Setup and sign-in](setup-and-sign-in.md) · [Onboarding](../getting-started/onboarding.md)

Accounts created with Google have no password: sign in with Google; the commands below do not apply.

Use the same `--home` you onboarded with. If you run from the repository, use the `clisbot` function from the prepare step of [onboarding](../getting-started/onboarding.md#1-prepare).

## You still know the old password

Enter both values hidden, export them, then change the password through the API:

```bash
read -rsp 'Current password: ' CURRENT_OWNER_PASSWORD; printf '\n'
read -rsp 'New password: ' NEW_OWNER_PASSWORD; printf '\n'
export CURRENT_OWNER_PASSWORD NEW_OWNER_PASSWORD
clisbot hub password change --home "$HOME/.clisbot-dev-01" \
  --email "$OWNER_EMAIL" \
  --current-password '${CURRENT_OWNER_PASSWORD}' \
  --new-password '${NEW_OWNER_PASSWORD}'
```

The new password needs at least 12 characters. Other sessions are signed out. `--owner-password` at init only creates the initial account and **does not reset an existing account**.

## Forgot the password: recovery with the master password

Recovery is **off** by default. The operator must set `CLISBOT_MASTER_PASSWORD` in the Hub's environment; this secret can reset **every account password on the Hub**. Use a random secret of 32–1024 ASCII characters with no spaces, different from any account password; keep it in a password manager or a separate file outside the bot workspace.

If it is in `.env`, load the file again as in onboarding. If not configured yet, enter the secret you created and stored separately, hidden:

```bash
read -rsp 'Hub master password: ' CLISBOT_MASTER_PASSWORD; printf '\n'
export CLISBOT_MASTER_PASSWORD
clisbot hub stop --home "$HOME/.clisbot-dev-01"
clisbot hub start --home "$HOME/.clisbot-dev-01"
```

Only the Hub needs a restart; the daemon can keep running. An export lives only in the shell and its child processes; if the Hub runs as a service, set the variable in the service. Changing or removing the master password also needs a Hub restart; removing the variable turns recovery off.

To reset:

```bash
read -rsp 'New account password: ' NEW_OWNER_PASSWORD; printf '\n'
export NEW_OWNER_PASSWORD
clisbot hub password reset --home "$HOME/.clisbot-dev-01" \
  --email "$OWNER_EMAIL" \
  --master-password '${CLISBOT_MASTER_PASSWORD}' \
  --new-password '${NEW_OWNER_PASSWORD}'
```

The new password is 12–128 characters and must differ from the master password. Sign in again after the reset: old account sessions are revoked; bots, files, workspaces, permissions, channel tokens and API keys are kept. Only CLI/API exist today; there is no "Forgot password" form on the web and no email recovery.

| Result                   | What next?                                                                       |
| ------------------------ | -------------------------------------------------------------------------------- |
| `401`                    | Check that the master password you use matches the variable **the Hub loaded**.  |
| `404`                    | Check the Hub version, that recovery is on and that the account email exists.    |
| `429`                    | Wait at least 60 seconds; the limit is 5 attempts per minute per Hub process.    |
| No confirmation received | Try signing in with the new password to learn the result before resetting again. |

The CLI sends the secret only over HTTPS or loopback HTTP and does not follow redirects. The master password is never printed in output or passed into agent/terminal environments. **A bot that can read `.env`, the Hub process or the Hub database can still obtain this power**; do not ask a bot to reset for you. This is not OS-level privilege isolation.

## No password and no master password

If you have not changed the password since init, check the `INITIAL_OWNER_PASSWORD` you saved. If you are a Member, contact the Hub operator; do not send secrets through tickets or chat.

If you still have admin rights on the machine, the operator can configure a new master password as above. Keep and back up the home before changing the environment. Without admin rights or recovery information, there is no way to recover the account yourself today. You can set up a new Hub and reuse workspace files you can still reach; Hub history and configuration do not carry over. **Do not delete the old home to attempt a reset.**
