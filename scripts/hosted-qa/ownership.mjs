export function assertOwnership(state, root, project) {
  if (state?.marker !== "domi-ops-hosted-qa-v1" || state.root !== root || state.project !== project || state.image !== `${project}:local`) throw new Error("QA ownership mismatch; refusing to operate");
  const ports = Object.values(state.ports ?? {});
  if (ports.length !== 7 || new Set(ports).size !== 7 || ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)) throw new Error("Invalid QA ports");
  for (const name of ["ADMIN_PASSWORD", "APP_PASSWORD", "SESSION_SECRET", "ENCRYPTION_KEY", "S3_PASSWORD", "TOKEN"]) if (!/^[a-f0-9]{64}$/.test(state.secrets?.[name] ?? "")) throw new Error("Invalid QA secrets");
}

export function assertVolumes(volumes, project) {
  const allowed = new Set(["database", "archive", "redis", "objects", "state"]);
  for (const volume of volumes) {
    if (volume.Labels?.["com.docker.compose.project"] !== project || !allowed.has(volume.Labels?.["com.docker.compose.volume"]) || volume.Name !== `${project}_${volume.Labels["com.docker.compose.volume"]}`) throw new Error("Volume ownership mismatch; refusing to reset");
  }
}
