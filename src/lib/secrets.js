import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { getConfig } from './config.js';

const client = new SecretsManagerClient({ region: getConfig().awsRegion });
const cache = new Map();
const TTL_MS = Number(process.env.SECRET_CACHE_TTL_MS) || 5 * 60 * 1000;

export async function getSecret(arn) {
  const hit = cache.get(arn);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.value;
  const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  const value = res.SecretString ?? '';
  if (!value) throw new Error(`Secret ${arn} has no SecretString`);
  cache.set(arn, { value, fetchedAt: Date.now() });
  return value;
}

export async function getSecretJson(arn) {
  const raw = await getSecret(arn);
  return JSON.parse(raw);
}
