export { telemetryRoute, privateTelemetryFields } from "./telemetry-privacy.js";
export const DIAGNOSTIC_DATA_COLLECTION = {
  userInfo: false, cookies: false, httpHeaders: { request: false, response: false },
  httpBodies: [], urlQueryParams: false, graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false }, databaseQueryData: false, queues: false,
  stackFrameVariables: false, frameContextLines: 0,
};

/** Browser-safe allowlist. Error messages, console arguments, request content and
 * local variables may contain medical data, SQL parameters or OAuth/invite tokens. */
export function scrubDiagnosticEvent<T extends object>(event: T): T {
  const source = event as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of ["event_id", "timestamp", "platform", "level", "environment", "release"]) {
    const value = source[key];
    if (typeof value === "number" || (typeof value === "string" && /^[\w.@+-]{1,128}$/.test(value))) output[key] = value;
  }
  const exception = source.exception as { values?: { type?: string; stacktrace?: { frames?: Record<string, unknown>[] } }[] } | undefined;
  if (exception?.values?.length) output.exception = { values: exception.values.map((entry) => ({
    type: entry.type && /^[\w.$]{1,80}$/.test(entry.type) ? entry.type : "Error",
    value: "Error details omitted for privacy",
    ...(entry.stacktrace?.frames ? { stacktrace: { frames: entry.stacktrace.frames.map((frame) => {
      const safe: Record<string, unknown> = {};
      if (typeof frame.filename === "string") safe.filename = frame.filename.split(/[?#]/, 1)[0]!.split(/[\\/]/).pop();
      if (typeof frame.function === "string" && /^[\w.$<> -]{1,120}$/.test(frame.function)) safe.function = frame.function;
      for (const key of ["lineno", "colno"]) if (typeof frame[key] === "number") safe[key] = frame[key];
      if (typeof frame.in_app === "boolean") safe.in_app = frame.in_app;
      return safe;
    }) } } : {}),
  })) };
  else output.message = "Domi Ops error; details omitted for privacy";
  const request = source.request as { method?: string } | undefined;
  if (request?.method && /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(request.method)) output.request = { method: request.method };
  const tags = source.tags as Record<string, unknown> | undefined;
  if (tags && typeof tags.jobName === "string" && /^[a-z.]{1,80}$/.test(tags.jobName)) output.tags = { jobName: tags.jobName };
  return output as T;
}
