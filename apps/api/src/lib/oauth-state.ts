import Redis from "ioredis";

const DEFAULT_TTL_SEC = 10 * 60;

let redisClient: Redis | null = null;

function getRedis(redisUrl: string): Redis {
  if (!redisClient) {
    redisClient = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
  }
  return redisClient;
}

export async function setOAuthState<T extends object>(
  redisUrl: string,
  keyPrefix: string,
  state: string,
  payload: T,
  ttlSec = DEFAULT_TTL_SEC,
): Promise<void> {
  const redis = getRedis(redisUrl);
  if (redis.status !== "ready") await redis.connect();
  await redis.set(`${keyPrefix}:${state}`, JSON.stringify(payload), "EX", ttlSec);
}

export async function getOAuthState<T extends object>(
  redisUrl: string,
  keyPrefix: string,
  state: string,
): Promise<T | null> {
  const redis = getRedis(redisUrl);
  if (redis.status !== "ready") await redis.connect();
  const raw = await redis.get(`${keyPrefix}:${state}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function deleteOAuthState(
  redisUrl: string,
  keyPrefix: string,
  state: string,
): Promise<void> {
  const redis = getRedis(redisUrl);
  if (redis.status !== "ready") await redis.connect();
  await redis.del(`${keyPrefix}:${state}`);
}

export async function consumeOAuthState<T extends object>(
  redisUrl: string,
  keyPrefix: string,
  state: string,
): Promise<T | null> {
  const payload = await getOAuthState<T>(redisUrl, keyPrefix, state);
  if (payload) await deleteOAuthState(redisUrl, keyPrefix, state);
  return payload;
}
