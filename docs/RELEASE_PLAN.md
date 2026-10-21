# Release cut: v0.11.3

Updated October 21, 2026. Patch release after v0.11.2, including Calendar fixes
in PRs #304/#305 and Withings check matching in PR #306. Use
[RELEASE_PROCESS.md](./RELEASE_PROCESS.md) for the release procedure.

## Scope

- Fixed-time vital checks combine complementary Withings cuff/watch entries and
  supplement already logged checks with later imports. Today displays mean BP,
  prefers the cuff's pulse, preserves all originals and respects health permissions.
- Calendar edits continue syncing after the first Google export. New exports,
  retries, destination changes and saves during an initial export retain their work.
- Calendar deletion uses a durable tenant-scoped outbox, and failed exports have
  actionable status. Calendar time-range selection preserves valid end times.

## Upgrade requirements

Upgrades from v0.11.2 require migration `0102_calendar_delete_outbox` and a
coordinated API/worker upgrade. The documented deployment scripts pause API and
worker before DDL, apply migrations with the admin connection, verify grants, then
start the new images. Failed migration/grant checks leave those services stopped
for recovery; fix forward before restarting. See `deploy/HOSTED_OPS.md`.

The Withings fix adds no migration or re-import requirement. Existing imported
entries participate when the new application reads their check sessions.

## Release gates

1. Obtain clean PR CI and CodeRabbit review; address or resolve every actionable
   thread before squash-merging the Withings fix.
2. Verify CI and image publishing on the resulting main commit. Reconcile newer
   main changes before choosing the release candidate.
3. Prepare a separate release PR updating root package/lockfile version metadata
   to 0.11.3 and dating the Unreleased changelog without changing dependencies.
4. Obtain clean release-PR CI and review, merge, then verify workflows for that
   exact main SHA before tagging.
5. Recheck remote v0.11.3 tags and GitHub Releases. Create the tag once at the
   verified release commit; never replace an existing tag.
6. Follow the tag-triggered Publish images workflow through all five images and
   hosted deployment. Verify image revision receipts and public API, login and
   marketing HTTP responses before publishing the GitHub Release.

Self-host deployments remain operator-run. This release procedure publishes the
images and uses the repository's hosted deployment workflow.
