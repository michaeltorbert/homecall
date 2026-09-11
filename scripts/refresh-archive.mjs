import { mkdir, writeFile } from 'node:fs/promises';
import { createCatalog } from '../lib/archive-source.mjs';
const catalog = await createCatalog();
const directory = new URL('../public/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('archive.json', directory), JSON.stringify(catalog));
for (const [school, value] of Object.entries(catalog.schools)) console.log(`${school}: ${value.status}, ${value.items.length} recordings`);
