# MyAllyFile medication sync

Operator notes for the MyAllyFile integration. The design and the wire contract are in
[ADR 006](./adr/006-myallyfile-med-sync.md). Linear: WHO-356, 357, 359, 360, 361, 362, 363.

## What it does

A household member can be linked to one MyAllyFile profile. The medications the user ticks are
copied to that profile (name, dose, instructions, schedule type, paused) whenever they change.
One way only. MyAllyFile checks the profile owner's plan on every sync (Plus or Pro).

## Turning it on

| Deployment | Behaviour |
|------------|-----------|
| Hosted (`DEPLOYMENT_MODE=shared` or `dedicated`) | On, talks to `https://us-central1-myallyfile.cloudfunctions.net` |
| Self-host | Off. Set `MYALLYFILE_API_BASE` to opt in |
| Local dev / QA | Set `MYALLYFILE_API_BASE=http://127.0.0.1:5001/myallyfile/us-central1` (MyAllyFile emulator) |

Needs `ENCRYPTION_KEY` (the link token is stored encrypted with it) and the `health` module.
The worker must be running; it pushes changes every 30 seconds after a 15 second quiet period.

## Link states

| `status` | Meaning | How it recovers |
|----------|---------|-----------------|
| `active` | Syncing | n/a |
| `entitlement_required` | MyAllyFile owner is not on Plus or Pro | Upgrade, then **Sync now** |
| `revoked` | Token rejected, or revoked from MyAllyFile | Unlink, link again with a new code |
| `error` | MyAllyFile profile deleted or not owned | Unlink, link again |

A rejected payload (`validation_failed`) keeps the link `active`, records `last_error`, and is
retried on the next medication change. Transient failures retry with backoff (30s doubling to
1h, 10 attempts), then wait for the next change or **Sync now**.

## Operating it

- Tokens are never returned by the API or written to logs. To kill a link, delete the row (or
  have the user unlink; that also calls `revokeLink`).
- `last_error` holds a short code only (for example `entitlement_required`), never medication data.
- Pending work is `health_myallyfile_links WHERE sync_requested_at IS NOT NULL`.
- Unlinking removes the synced medications on the MyAllyFile side. If MyAllyFile was unreachable
  when the user unlinked, the API reports `revokedRemotely: false`; the user can revoke from
  MyAllyFile Connected apps.
