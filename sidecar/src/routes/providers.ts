/**
 * Provider HTTP routes — CRUD for API providers
 */

import { Hono } from 'hono';
import {
  createProvider,
  getProvider,
  listProviders,
  updateProvider,
  deleteProvider,
  activateProvider,
} from '../db';

const providerRoutes = new Hono();

/** GET /providers — List all providers */
providerRoutes.get('/', (c) => {
  return c.json({ providers: listProviders() });
});

/** POST /providers — Create a new provider */
providerRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { name, type, api_key, base_url } = body;
  if (!name || !type) {
    return c.json({ error: 'name and type are required' }, 400);
  }
  const provider = createProvider({ name, type, api_key: api_key || '', base_url });
  return c.json({ provider }, 201);
});

/** GET /providers/:id — Get a provider */
providerRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const provider = getProvider(id);
  if (!provider) {
    return c.json({ error: 'Provider not found' }, 404);
  }
  return c.json({ provider });
});

/** PUT /providers/:id — Update a provider */
providerRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const provider = getProvider(id);
  if (!provider) {
    return c.json({ error: 'Provider not found' }, 404);
  }
  updateProvider(id, body);
  return c.json({ provider: getProvider(id) });
});

/** DELETE /providers/:id — Delete a provider */
providerRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  const provider = getProvider(id);
  if (!provider) {
    return c.json({ error: 'Provider not found' }, 404);
  }
  deleteProvider(id);
  return c.json({ success: true });
});

/** POST /providers/:id/activate — Set as default provider */
providerRoutes.post('/:id/activate', (c) => {
  const id = c.req.param('id');
  const provider = getProvider(id);
  if (!provider) {
    return c.json({ error: 'Provider not found' }, 404);
  }
  activateProvider(id);
  return c.json({ success: true });
});

export default providerRoutes;
