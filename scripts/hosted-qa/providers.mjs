import { createServer } from "node:http";
import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";

const token = process.env.QA_TOKEN;
if (token?.length !== 64) throw new Error("Harness token required");
const origin = process.env.QA_PROVIDER_PUBLIC_URL;
const stripe = new Stripe("sk_test_local_fixture");
const secret = process.env.QA_WEBHOOK_SECRET;
let state = await readFile("/qa/providers.json", "utf8").then(JSON.parse).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return { customers: {}, subscriptions: {}, sessions: {}, portals: {}, requests: {}, fixtures: null };
});
state.checkoutDeliveries ??= {};
let pendingSave = Promise.resolve();
const save = () => {
  const snapshot = JSON.stringify(state);
  pendingSave = pendingSave.then(async () => {
    await writeFile("/qa/providers.json.tmp", snapshot);
    await rename("/qa/providers.json.tmp", "/qa/providers.json");
  });
  return pendingSave;
};
const id = (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function event(type, object) {
  const payload = JSON.stringify({ id: id("evt"), object: "event", created: Math.floor(Date.now() / 1000), type, data: { object } });
  const result = await fetch("http://api:4000/api/billing/webhook", { method: "POST", body: payload, headers: { "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret }) }, signal: AbortSignal.timeout(15000) });
  if (!result.ok) throw new Error(`Fixture webhook failed: ${result.status} ${await result.text()}`);
}
createServer(async (req, res) => {
  const url = new URL(req.url, origin), path = url.pathname;
  const json = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
  const html = (body) => { res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Local hosted QA</title><main style="font:18px system-ui;max-width:650px;margin:40px auto;padding:20px"><h1>Local hosted QA</h1><p>Simulated payment provider. Synthetic data; no money moves.</p>${body}</main>`); };
  const redirect = (location) => { res.writeHead(303, { Location: location }); res.end(); };
  try {
    if (path === "/healthz") return json({ fixture: true });
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 65536) throw new Error("Request too large"); }
    const params = new URLSearchParams(body);
    if (path.startsWith("/__qa/")) {
      if (req.headers["x-qa-token"] !== token) return json({ error: "unauthorized" }, 401);
      if (path === "/__qa/fixtures") {
        if (req.method === "POST") { state.fixtures = JSON.parse(body); for (const item of state.fixtures.households) {
          state.customers[item.customerId] = { id: item.customerId, object: "customer", email: item.email };
          state.subscriptions[item.subscriptionId] = { id: item.subscriptionId, object: "subscription", customer: item.customerId, status: item.status, trial_end: null, cancel_at_period_end: false, items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } };
        } await save(); }
        return json(state.fixtures);
      }
      if (path === "/__qa/expire") {
        const { subscriptionId, customerId } = JSON.parse(body);
        const sub = customerId
          ? Object.values(state.subscriptions).findLast((item) => item.customer === customerId && item.status !== "canceled")
          : state.subscriptions[subscriptionId];
        if (!sub) return json({ error: "not_found" }, 404);
        sub.status = "canceled"; await save(); await event("customer.subscription.deleted", sub); return json({ ok: true });
      }
      return json({ error: "not_found" }, 404);
    }
    if (path === "/") return html(`<p><a href="${escape(state.fixtures?.appUrl)}">Open application</a> · <a href="${escape(state.fixtures?.marketingUrl)}">Open marketing</a></p><h2>Fixture accounts</h2><pre>${escape(state.fixtures ? JSON.stringify({ password: state.fixtures.password, households: state.fixtures.households.map(({ email, status }) => ({ email, status })), student: state.fixtures.student.username }, null, 2) : "Not seeded")}</pre>`);
    if (path.startsWith("/v1/")) {
      const cacheKey = req.headers["idempotency-key"] ? `${req.method}:${path}:${req.headers["idempotency-key"]}` : null;
      if (cacheKey && state.requests[cacheKey]) return json(state.requests[cacheKey]);
      let result;
      if (path === "/v1/customers" && req.method === "POST") { result = { id: id("cus"), object: "customer", email: null }; state.customers[result.id] = result; }
      else if (path === "/v1/checkout/sessions" && req.method === "POST") {
        result = { id: id("cs"), object: "checkout.session", mode: "subscription", status: "open", payment_status: "unpaid", customer: params.get("customer"), client_reference_id: params.get("client_reference_id"), success_url: params.get("success_url"), cancel_url: params.get("cancel_url"), trial: params.get("subscription_data[trial_period_days]") === "14", price: params.get("line_items[0][price]") };
        result.url = `${origin}/checkout/${result.id}`; state.sessions[result.id] = result;
      } else if (path.startsWith("/v1/checkout/sessions/")) result = state.sessions[path.split("/").pop()];
      else if (path.startsWith("/v1/subscriptions/")) {
        result = state.subscriptions[path.split("/").pop()];
        if (result && req.method === "DELETE") result.status = "canceled";
      } else if (path === "/v1/billing_portal/sessions") {
        result = { id: id("bps"), object: "billing_portal.session", customer: params.get("customer"), return_url: params.get("return_url") };
        result.url = `${origin}/portal/${result.id}`; state.portals[result.id] = result;
      }
      if (!result) return json({ error: { message: "Unsupported local Stripe fixture request" } }, 404);
      if (cacheKey) state.requests[cacheKey] = result;
      await save(); return json(result);
    }
    const session = state.sessions[path.split("/")[2]];
    if (path.startsWith("/checkout/") && session) {
      if (req.method === "GET") return html(`<h2>${session.trial ? "14-day trial" : "Paid restart"}</h2><p>${escape(session.price)}</p><form method="post"><label>Email <input name="email" type="email" required value="${escape(state.customers[session.customer]?.email)}"></label><button type="submit">Complete simulated checkout</button></form>`);
      if (session.status !== "complete") {
        const customer = state.customers[session.customer]; customer.email = params.get("email");
        const end = Math.floor(Date.now() / 1000) + (session.trial ? 14 : 30) * 86400;
        const sub = { id: id("sub"), object: "subscription", customer: customer.id, status: session.trial ? "trialing" : "active", trial_end: session.trial ? end : null, cancel_at_period_end: false, items: { data: [{ current_period_end: end }] } };
        state.subscriptions[sub.id] = sub;
        Object.assign(session, { status: "complete", payment_status: session.trial ? "no_payment_required" : "paid", subscription: sub.id, customer_details: { email: customer.email } });
        state.checkoutDeliveries[session.id] = false;
        await save();
      }
      if (!state.checkoutDeliveries[session.id]) {
        await event("checkout.session.completed", session);
        state.checkoutDeliveries[session.id] = true;
        await save();
      }
      return redirect(session.success_url.replace("{CHECKOUT_SESSION_ID}", session.id));
    }
    const portal = state.portals[path.split("/")[2]];
    if (path.startsWith("/portal/") && portal) {
      if (req.method === "GET") return html(`<h2>Manage subscription</h2><form method="post"><button>Cancel at period end</button></form><p><a href="${escape(portal.return_url)}">Return to settings</a></p>`);
      const sub = Object.values(state.subscriptions).findLast((item) => item.customer === portal.customer && item.status !== "canceled");
      if (sub) { sub.cancel_at_period_end = true; await save(); await event("customer.subscription.updated", sub); }
      return redirect(portal.return_url);
    }
    return json({ error: "not_found" }, 404);
  } catch (error) { console.error(error); return json({ error: error.message }, 500); }
}).listen(4080, "0.0.0.0");
