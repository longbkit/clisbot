#!/usr/bin/env bash
# Configure this clone's remotes so `refs/tags/` only ever holds our fork's tags.
#
# Both upstreams publish `v*` tags into the same flat namespace as `origin`, and
# whichever fetch runs last wins. That is not hypothetical: on 2026-09-14 local
# `v0.8.0` pointed at the Hub release, so `git checkout v0.8.0` gave the wrong
# repository's code, and `git fetch upstream --tags` could not repair it
# ("would clobber existing tag"). Five of origin's own tags (v0.1.39, v0.1.41,
# v0.1.43, v0.1.50, v0.1.53) share a name with a different Paseo commit.
#
# The rule: `refs/tags/` mirrors `origin`. An upstream release is fetched on
# demand into its own namespace, which is what the sync playbook already does:
#
#   git fetch --no-tags upstream     refs/tags/vX.Y.Z:refs/upstream-releases/vX.Y.Z
#   git fetch --no-tags hub-upstream refs/tags/vX.Y.Z:refs/hub-releases/vX.Y.Z
#
# Run once per clone. Safe to re-run.
set -euo pipefail

for remote in upstream hub-upstream; do
  if ! git config --get "remote.${remote}.url" > /dev/null; then
    echo "skip ${remote}: remote not configured"
    continue
  fi
  git config "remote.${remote}.tagOpt" --no-tags
  git config --replace-all "remote.${remote}.fetch" "+refs/heads/*:refs/remotes/${remote}/*"
  echo "configured ${remote}: branches only, no tags"
done

stray=$(comm -23 <(git tag -l | sort) \
  <(git ls-remote --tags origin | grep -v '\^{}' | sed 's#.*refs/tags/##' | sort) | wc -l)
if [ "${stray}" -gt 0 ]; then
  echo
  echo "${stray} local tags are not on origin — leftovers from an earlier tag fetch."
  echo "Review them, then drop them so local and origin agree:"
  echo "  comm -23 <(git tag -l | sort) \\"
  echo "    <(git ls-remote --tags origin | grep -v '\\^{}' | sed 's#.*refs/tags/##' | sort) \\"
  echo "    | xargs git tag -d"
fi
