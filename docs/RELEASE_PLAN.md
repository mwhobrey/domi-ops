# Release cut: v0.11.2

Updated October 19, 2026. Planned patch cut from v0.11.1, following the merged
[UI/export fixes in PR #302](https://github.com/mwhobrey/domi-ops/pull/302).
Use [RELEASE_PROCESS.md](./RELEASE_PROCESS.md) for the release procedure.

## Scope

- Withings history period and Import history stay grouped separately from Sync now.
- Report exports distinguish document format, cloud saves, file downloads and printing.
- School CSV/cloud exports use the selected student; all-student downloads are explicit.
- Expense exports retain Household/Me scope, with personal scope bound to the signed-in member.
- Superseded preview responses cannot replace current download/print content or unlock pending actions.
- The calendar creation destination remains labeled on mobile, separately from visibility filters.

This is a patch: no new features, dependencies, environment variables or database
migrations since v0.11.1. Upgrades from earlier versions still need their existing
migration and acceptance steps.

## Verified starting point

- Latest published release and root package version: v0.11.1.
- PR #302 merged as `40f8256b39fe5f93d0fb9d6a4dde3a5cc7479ee8`.
- All seven checks passed on its final PR head: build, hosted tenant tests and five image builds.
- The merge commit's [CI](https://github.com/mwhobrey/domi-ops/actions/runs/39321592597)
  and [Publish images](https://github.com/mwhobrey/domi-ops/actions/runs/39321592675)
  runs must pass before cutting. PR checks do not replace these merge checks.
- No remote v0.11.2 tag was present when checked. Recheck tags and GitHub Releases immediately before cutting.

## Cut sequence

1. Wait for the merge commit's CI and Publish images runs to succeed. Reconcile
   any newer main changes before choosing the release candidate.
2. Prepare a release PR from current main:
   - Bump root `package.json` and root `package-lock.json` version metadata from
     0.11.1 to 0.11.2 without changing dependency resolutions.
   - Move the merged fixes from `[Unreleased]` to `[0.11.2]` with the actual cut date;
     leave a fresh `[Unreleased]` heading. Include the no-new-migrations note.
   - Use `:bookmark: chore(release): v0.11.2` and link PR #302 in the release notes.
3. Obtain clean release-PR CI and resolved review threads, then merge. Verify CI
   on the resulting main commit before tagging; record that exact SHA.
4. Recheck remote tags and GitHub Releases for v0.11.2. If it already exists,
   inspect its state instead of overwriting it. Tag the verified release commit
   and push the new tag once.
5. Follow the v0.11.2 run of `.github/workflows/publish-images.yml` through all five
   image builds and the hosted deployment. The main-branch publish run alone does
   not establish a hosted deployment. Use the workflow deployment path.
6. Verify hosted `/api/healthz`, `/login` and the marketing site; record the version,
   workflow URL, image/deployment receipts and HTTP results. Check the affected
   controls at phone and desktop widths. Use synthetic records for export checks;
   missing real Withings readings still require their own import verification.
7. Publish the GitHub Release for the verified tag with the matching changelog
   notes. Record completion only after deployment and smoke checks succeed.

Keep [ROLLBACK.md](./ROLLBACK.md) available; v0.11.1 is the prior release baseline.

## Current status

Execution authorized on October 19, 2026. Candidate version/lockfile metadata and
the dated changelog are prepared for the release PR. PR/merge checks, tagging,
deployment verification and publication remain the execution gates above. Final
workflow and deployment receipts belong on the GitHub Release for v0.11.2.
