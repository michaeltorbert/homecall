import {readFileSync} from 'node:fs';
import {validatePrivateCatalog} from '../lib/private-catalog.mjs';
try {
  const raw=readFileSync(process.argv[2]);
  if(raw.length>5_000_000)throw Error();
  const c=validatePrivateCatalog(JSON.parse(raw));
  console.log(`Private catalog valid: ${Object.keys(c.live).length} live sources; ${Object.values(c.archive.schools).reduce((n,s)=>n+s.items.length,0)} recordings. Values withheld.`);
}catch{console.error('Private catalog validation failed; values withheld.');process.exit(1);}
