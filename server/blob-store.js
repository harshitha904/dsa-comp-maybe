import { get, put } from '@vercel/blob';
import { seedData } from './seed.js';

const pathname = 'mastergraph/state-v1.json';
const options = { access: 'private', addRandomSuffix: false, contentType: 'application/json' };

export async function loadBlobState({ getBlob = get, putBlob = put } = {}) {
  let result = await getBlob(pathname, { access: 'private', useCache: false });
  if (!result) {
    try {
      await putBlob(pathname, JSON.stringify(seedData()), { ...options, allowOverwrite: false });
    } catch (error) {
      // Accept a competing cold start only after a valid durable read.
      result = await getBlob(pathname, { access: 'private', useCache: false });
      if (!result || result.statusCode !== 200 || !result.blob.etag) throw error;
    }
    result = await getBlob(pathname, { access: 'private', useCache: false });
  }
  if (!result || result.statusCode !== 200) throw new Error('Durable state unavailable');
  const state = JSON.parse(await new Response(result.stream).text());
  // Private GET responses may weaken the ETag when transfer compression is used.
  // Blob's conditional write API expects the quoted origin token.
  const etag = result.blob.etag?.replace(/^W\//, '');
  if (!etag) throw new Error('Durable storage did not provide a concurrency token');
  return { state, etag };
}

export function memoryStore(initial) {
  let state = structuredClone(initial);
  let dirty = false;
  return {
    all: () => structuredClone(state),
    put(collection, item) {
      state[collection] ??= [];
      const index = state[collection].findIndex(row => row.id === item.id);
      if (index < 0) state[collection].push(structuredClone(item));
      else state[collection][index] = structuredClone(item);
      dirty = true;
    },
    transaction(fn) {
      const before = structuredClone(state), wasDirty = dirty;
      try { return fn(); } catch (error) { state = before; dirty = wasDirty; throw error; }
    },
    reset() { state = seedData(); dirty = true; },
    get dirty() { return dirty; },
  };
}

export async function saveBlobState(state, etag) {
  await put(pathname, JSON.stringify(state), { ...options, allowOverwrite: true, ifMatch: etag });
}
