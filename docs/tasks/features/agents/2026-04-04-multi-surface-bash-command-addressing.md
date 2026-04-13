# Multi-Surface Bash Command Addressing

## Goal

Extend agent-scoped bash commands beyond the one default reusable shell surface.

## Why This Exists

The current model keeps one reusable `bash` window per agent session.

That is the right default for now, but later the command surface should support explicit routing such as:

- `!1:`
- `!bash:`
- one-off shell execution when isolation is preferred
- multiple named shell surfaces inside one agent session

## Scope

- define the user-facing command grammar for explicit shell-surface addressing
- define how shell surface names or indices map to tmux runner targets
- define when a command should reuse an existing shell versus create a one-off shell
- keep runner-specific target resolution out of channel code

## Out Of Scope

- changing the current default single-shell behavior
- generic operator attach or inspect workflows

## Acceptance Criteria

- the command grammar for default, indexed, named, and one-off shell execution is defined
- the default behavior remains one reusable shell surface per agent session
- the mapping between agent commands and runner shell surfaces is unambiguous
- docs and tests explain how shell-surface routing should work
