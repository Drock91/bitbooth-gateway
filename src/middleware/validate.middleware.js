import { ValidationError } from '../lib/errors.js';

export function parseBody(schema, raw) {
  if (!raw) throw new ValidationError({ body: 'missing' });
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ValidationError({ body: 'invalid-json' });
  }
  const result = schema.safeParse(json);
  if (!result.success) throw new ValidationError(result.error.flatten());
  return result.data;
}

export function parseQuery(schema, query) {
  const result = schema.safeParse(query ?? {});
  if (!result.success) throw new ValidationError(result.error.flatten());
  return result.data;
}
