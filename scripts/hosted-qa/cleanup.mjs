export async function cleanupAll(steps, cause) {
  const errors = [];
  for (const step of steps) {
    try { await step(); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Hosted QA cleanup failed", { cause });
}
