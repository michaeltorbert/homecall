// Committed Now Playing artwork files: sources stay self-contained, PNGs are 512 x 512 and opaque,
// and every byte matches PROVENANCE.md. File checks only; not native lock-screen or car proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { ARTWORK_PATH, TEAM_ARTWORK } from '../src/now-playing.js';
const DIR = new URL('../public/', import.meta.url);
const read = file => readFileSync(new URL(file, DIR));
const sha = buf => createHash('sha256').update(buf).digest('hex');
const provenance = read('now-playing/PROVENANCE.md').toString('utf8');
const GENERIC = { svg: '57ec6d27b32b94c565fde3d7d5bb3fa33162c952ad5748eeeca058b8ef7ea8a4', png: '51bcc5af2d693d8d4615329dd5c21384f3a9e32884ae3a2304a2ababf3431b85' };

// Minimal PNG reader: IHDR plus unfiltered pixels, so alpha can be checked whatever the filter.
function png(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  let p = 8, ihdr = null, trns = false; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    if (type === 'tRNS') trns = true;
    p += 12 + len;
    if (type === 'IEND') break;
  }
  const bpp = ihdr.colorType === 6 ? 4 : 3, stride = ihdr.width * bpp, raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * ihdr.height);
  for (let y = 0, q = 0; y < ihdr.height; y++) {
    const f = raw[q++], row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = y && x >= bpp ? px[row - stride + x - bpp] : 0;
      let v = raw[q++];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  let minAlpha = 255;
  if (bpp === 4) for (let i = 3; i < px.length; i += 4) minAlpha = Math.min(minAlpha, px[i]);
  return { ...ihdr, trns, minAlpha };
}
// Rows the rasterizer writes between the team-artwork markers.
function recorded(key) {
  const block = provenance.split('<!-- team-artwork-hashes:start -->')[1]?.split('<!-- team-artwork-hashes:end -->')[0] ?? '';
  const row = block.split('\n').find(line => line.startsWith(`| \`${key}-512.png\``));
  const [svg, pngHash] = row ? [...row.matchAll(/`([0-9a-f]{64})`/g)].map(m => m[1]) : [];
  return { svg, png: pngHash };
}

test('the generic Homecall source and PNG are byte-identical to the released image', () => {
  assert.equal(ARTWORK_PATH, 'now-playing/homecall-512.png');
  assert.equal(sha(read('now-playing/homecall-512.svg')), GENERIC.svg);
  assert.equal(sha(read('now-playing/homecall-512.png')), GENERIC.png);
  assert.ok(provenance.includes(GENERIC.svg) && provenance.includes(GENERIC.png));
});
test('team SVG sources are self-contained original primitives: no text, fonts, images, links, styles, scripts or filters', () => {
  for (const key of Object.keys(TEAM_ARTWORK)) {
    const svg = read(`now-playing/${key}-512.svg`).toString('utf8');
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'), key);
    assert.ok(svg.includes('<rect width="512" height="512" fill="#10151e"/>'), `${key}: full opaque background`);
    assert.doesNotMatch(svg, /<text|<tspan|<image|<foreignObject|<script|<style|<filter|<use|href|url\(|font-family|@font-face|@import|opacity|data:/i, key);
    assert.deepEqual(svg.match(/https?:\/\/[^\s"']+/g), ['http://www.w3.org/2000/svg'], `${key}: the namespace is the only URL`);
  }
});
test('every team PNG and the generic PNG are 512 x 512, 8-bit and fully opaque, and team files match PROVENANCE.md', () => {
  for (const key of [...Object.keys(TEAM_ARTWORK), 'homecall']) {
    const file = key === 'homecall' ? ARTWORK_PATH : TEAM_ARTWORK[key], buf = read(file), info = png(buf);
    assert.deepEqual([info.width, info.height, info.depth, info.interlace], [512, 512, 8, 0], file);
    assert.ok(info.colorType === 2 || (info.colorType === 6 && info.minAlpha === 255), `${file}: RGB, or RGBA with every alpha 255`);
    assert.equal(info.trns, false, `${file}: no tRNS`);
    if (key === 'homecall') continue;
    const row = recorded(key);
    assert.equal(sha(read(`now-playing/${key}-512.svg`)), row.svg, `${key}: SVG hash recorded`);
    assert.equal(sha(buf), row.png, `${key}: PNG hash recorded`);
  }
});
