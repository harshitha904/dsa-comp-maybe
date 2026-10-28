import express from 'express';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { createApp } from '../server/index.js';
import { loadBlobState, memoryStore, saveBlobState } from '../server/blob-store.js';

export function createHandler({ loadState = loadBlobState, saveState = saveBlobState } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const { state, etag } = await loadState();
      const store = memoryStore(state);
      const app = express();
      // Express initializes response helpers before this middleware executes.
      app.use((req, res, next) => {
        const sendBody = res.send.bind(res);
        res.send = function (body) {
          if (!store.dirty || res.statusCode >= 400) return sendBody(body);
          saveState(store.all(), etag).then(() => sendBody(body)).catch(error => {
            if (error instanceof BlobPreconditionFailedError) {
              res.statusCode = 409;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              sendBody(JSON.stringify({ error: 'Data changed while processing this request. Refresh and retry.' }));
            } else {
              console.error('Durable state write failed:', error.name);
              res.statusCode = 503;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              sendBody(JSON.stringify({ error: 'Durable storage unavailable. No success was acknowledged; refresh before retrying.' }));
            }
          });
          return res;
        };
        next();
      });
      app.use(createApp(store));
      // Keep the invocation alive until the durable write and response complete.
      await new Promise((resolve, reject) => {
        res.once('finish', resolve);
        res.once('close', resolve);
        res.once('error', reject);
        app(req, res);
      });
    } catch (error) {
      console.error('Durable state initialization failed:', error.name);
      if (res.headersSent) return;
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Durable storage unavailable. Check the project Blob connection.' }));
    }
  };
}

export default createHandler();
