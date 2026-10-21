# ADR 007: shared MCP integration for self-host and Cloud

Status: Accepted for implementation
Date: 2026-10-21
Linear: WHO-467, WHO-468, WHO-485, WHO-486

## Context

The owner approved standard assistant integration in base hosted pricing and free
MIT self-hosting. Both deployment modes must use the same authorization/tool
contract. Self-host dogfood cannot establish shared hosted tenant isolation.

## Decision

Use a guarded stateless MCP v2 endpoint in Hono, a deployment-local Better Auth
OAuth provider, immutable member/client/household grants checked on every call,
and pure read services. Pin the versions verified by the isolated M1 probe; keep
existing login/session and Google credentials separate from delegated access.

Start with persisted shopping/chores and explicitly selected notes. Integrations
are optional connection capabilities, not content modules or a new billing SKU.
Pre-register approved clients; disable anonymous registration and machine grants.
Consumer Gemini is synthetic-only initially because its required activity setting
does not meet the selected non-training real-data pilot policy. Client settings
attestations are not technical guarantees of third-party handling.

The complete [M1 decision record](../MCP_M1_DECISIONS.md) defines routes, schema,
scope/consent, retention, limits and implementation slices. Its compatibility
receipts prove synthetic library/adapter composition, not a production release.

## Consequences

No Cloud account/license relay is needed for self-hosting. Hosted logical reads
remain available in subscription read-only mode, with record/module permissions.
Application RLS, consent concurrency, real proxy/TLS and vendor client acceptance
remain implementation gates in M2–M4. Google/Health/School and writes stay outside
v1. No production configuration or dependency changes are made by this ADR.
