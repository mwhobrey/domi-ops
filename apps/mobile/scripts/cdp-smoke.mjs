const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((p) => p.type === "page") ?? list[0];
if (!page?.webSocketDebuggerUrl) {
  console.error("no page", list);
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  const p = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }
    }, 20000);
  });
  ws.send(JSON.stringify({ id, method, params }));
  return p;
}

ws.addEventListener("message", (ev) => {
  const data = JSON.parse(ev.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(new Error(JSON.stringify(data.error)));
    else resolve(data.result);
  }
});

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});

await send("Runtime.enable");
const result = await send("Runtime.evaluate", {
  expression: `(() => {
    const plugins = Object.keys(globalThis.Capacitor?.Plugins || {});
    const Http = globalThis.Capacitor?.Plugins?.CapacitorHttp;
    return JSON.stringify({
      href: location.href,
      plugins,
      hasHttp: Boolean(Http),
      httpMethods: Http ? Object.keys(Http) : [],
      status: document.getElementById('status')?.textContent || '',
      btn: document.getElementById('connect-btn')?.disabled,
    });
  })()`,
  returnByValue: true,
});
console.log("before", result.result?.value);

const click = await send("Runtime.evaluate", {
  expression: `(async () => {
    const btn = document.getElementById('connect-btn');
    if (!btn) return JSON.stringify({ error: 'no button' });
    btn.disabled = false;
    btn.click();
    await new Promise((r) => setTimeout(r, 10000));
    return JSON.stringify({
      href: location.href,
      status: document.getElementById('status')?.textContent || '',
      statusClass: document.getElementById('status')?.className || '',
      btnDisabled: document.getElementById('connect-btn')?.disabled,
    });
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log("after", click.result?.value);
ws.close();
