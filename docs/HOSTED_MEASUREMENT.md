# Hosted measurement

Keep optional product metrics off by default. Do not link browser anonymous IDs to
accounts, payments or household records. Do not add pixels, private text, children's
work, health details, email addresses, exact record paths or invitation tokens to
acquisition or product events.

The browser collector now accepts fixed usage/error categories and Web Vitals,
reduces paths to a module name, discards arbitrary metadata, bounds payloads, and
clears queued events/listeners and its random ID on opt-out. Re-enabling creates a
new ID. Explicit feedback messages are separate user-authored submissions. Configured
Sentry diagnostics are separate and scrubbed before transport; see [TELEMETRY.md](TELEMETRY.md).

## Funnel and honest limits

| Stage | Evidence source | Current measurement |
| --- | --- | --- |
| Qualified discovery / pricing visit | Consented pilot interview and coarse optional page usage | No cross-site visitor-to-payment attribution; do not invent it |
| Checkout start / completion / payment | Stripe test/live dashboard and store receipts | Provider evidence; a created request or synthetic webhook is not a paid conversion |
| Setup / first useful School or Health work | Aggregate report below | Opted-in hosted households; record creation within 7 days |
| Second household participant | Aggregate report plus pilot observation | Report counts an active second membership, not a proven second login |
| Paid renewal / cancellation | Provider invoice/renewal receipts and cancellation state | Report only provides a current active-after-30-days or canceled snapshot; it does not prove a renewal |
| Support burden / reason to stay or leave | Consented support/pilot notes | Measure actual assistance time and reasons; redact household content before sharing |

The acquisition and paid-renewal joins are deliberately left out of anonymous
telemetry. Run the complete funnel as a consented pilot/provider review, not by
silently changing the privacy promise. No conversion or retention figures have been
measured by this remediation.

## Aggregate activation report

Supply `METRICS_DATABASE_URL` explicitly and run:

```text
mise exec -- npx tsx scripts/hosted-activation-report.mts
```

The operator report reads only hosted households that enabled optional metrics,
scopes workflow checks per household, then returns monthly counts. It exports no
IDs, names, record contents or event-level observations. Cohorts under five are
suppressed. Opted-in users are a selected population; these counts are not the whole
customer base. Imported historical timestamps and deleted records can affect the
observations. Preserve those caveats with every receipt.

Keep raw provider receipts and support notes access-restricted. Use aggregate
research findings for positioning. Set and verify telemetry, feedback and diagnostic
retention before launch; do not keep identifiable pilot notes indefinitely.
