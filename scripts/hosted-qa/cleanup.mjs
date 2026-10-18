import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

export async function cleanupAll(steps, cause) {
  const errors = [];
  for (const step of steps) {
    try { await step(); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Hosted QA cleanup failed", { cause });
}

export function restorePrefixCleanupSteps(client, bucket, prefixes) {
  return prefixes.map((prefix) => async () => {
    const errors = [];
    let cursor;
    do {
      let page;
      try { page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: cursor })); }
      catch (error) { errors.push(error); break; }
      for (const object of page.Contents ?? []) {
        try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key })); }
        catch (error) { errors.push(error); }
      }
      cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (cursor);
    if (errors.length) throw new AggregateError(errors, `Restore cleanup failed for ${prefix}`);
  });
}
