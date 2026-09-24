# LOOP.md - Default Maintenance Loop

On each loop iteration, work through the following in order:

1. Continue any unfinished work from the current conversation.
2. Tend to the current branch's pull request:
   - review comments
   - failed CI runs
   - merge conflicts
3. If nothing is pending, run a cleanup pass:
   - bug hunt
   - simplification
   - small polish that stays within the current scope

Do not start unrelated new initiatives.

Irreversible actions such as pushing, merging, deleting, or force-updating only proceed when they continue something already authorized in the transcript.
