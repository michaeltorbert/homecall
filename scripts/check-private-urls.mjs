// No private address inventory belongs in this scanner. Scan an optional local
// inventory by exact value; use structural checks without it in public CI.
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const dist=process.argv.includes('--dist');
const walk=dir=>readdirSync(dir).flatMap(name=>{const p=`${dir}/${name}`;return statSync(p).isDirectory()?walk(p):[p];});
const files=dist?(existsSync('dist')?walk('dist'):[]):execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8'}).split('\0').filter(Boolean);
let values=[];
if(process.env.HOMECALL_CATALOG_FILE){const c=JSON.parse(readFileSync(process.env.HOMECALL_CATALOG_FILE));values=[...Object.values(c.live).map(x=>x.url),c.discovery?.homestreamBase,c.archiveConfig?.vtFeed,...Object.values(c.archive.schools).flatMap(s=>s.items.map(i=>i.url))].filter(Boolean);}
let failures=0;
for(const file of files){if(!existsSync(file)||!statSync(file).isFile()||file==='package-lock.json')continue;const text=readFileSync(file,'utf8');if(values.some(value=>text.includes(value)))failures++;
 if((dist||file.startsWith('src/'))&&/https?:\/\/[^\s'"<>]*(?:\.m3u8|\.mp3)(?:[?'"\s]|$)/i.test(text))failures++;
 if(file==='public/archive.json')failures++;
}
if(failures){console.error(`Private address check failed in ${failures} checks. Address values withheld.`);process.exit(1);}
console.log(`Private address check passed (${dist?'build':'working source'}; ${values.length?'private inventory included':'structural rules only'}).`);
