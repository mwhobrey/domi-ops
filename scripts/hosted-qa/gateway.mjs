import { createServer as httpServer, request } from "node:http";
import { createServer as tcpServer, connect } from "node:net";

// Fixed destinations only. Backends stay on the internal network; this service has
// no database/provider credentials and only loopback-bound ports are published.
for (const [port, hostname, targetPort] of [[3000, "web", 3000], [3001, "www", 3002], [8025, "mail", 8025], [4080, "providers", 4080], [9000, "minio", 9000]]) {
  httpServer((req, res) => {
    const headers = { ...req.headers };
    delete headers["forwarded"]; delete headers["x-forwarded-for"]; delete headers["x-forwarded-host"]; delete headers["x-forwarded-proto"];
    const upstream = request({ hostname, port: targetPort, path: req.url, method: req.method, headers }, (response) => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end("QA service is starting"); });
    req.on("aborted", () => upstream.destroy()); req.pipe(upstream);
  }).listen(port, "0.0.0.0");
}
for (const [port, hostname] of [[5432, "postgres"], [5433, "archive"]]) {
  tcpServer((socket) => {
    const upstream = connect(5432, hostname);
    socket.on("error", () => upstream.destroy()); upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy()); upstream.on("close", () => socket.destroy());
    socket.pipe(upstream); upstream.pipe(socket);
  }).listen(port, "0.0.0.0");
}
console.log("Local hosted QA gateway ready");
