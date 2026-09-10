import { pipeline, env } from '@huggingface/transformers';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {extractRadioClockCandidates,associateRadioPeriods} from '../src/radio-index.js';
env.cacheDir = '/private/tmp/mystream-models';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node scripts/transcribe-replay.mjs input.wav output.json');
const bytes = await readFile(input);
let offset = 12, pcm, rate, channels, bits;
while (offset + 8 <= bytes.length) {
  const tag = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
  if (tag === 'fmt ') { channels=bytes.readUInt16LE(start+2); rate=bytes.readUInt32LE(start+4); bits=bytes.readUInt16LE(start+14); }
  if (tag === 'data') pcm=bytes.subarray(start,start+size);
  offset=start+size+(size%2);
}
if (!pcm || rate!==16000 || channels!==1 || bits!==16) throw Error('Expected 16-kHz mono 16-bit PCM WAV');
const audio = Float32Array.from({length:pcm.length/2}, (_,i)=>pcm.readInt16LE(i*2)/32768);
console.log(`Audio ${audio.length/16000}s; loading local speech model.`);
const model = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', { dtype:'q8' });
const started=performance.now();
let result;
if(process.argv.includes('--stream-windows')) {
  const windows=[], candidates=[];
  for(let start=0;start+20<=audio.length/16000;start+=10) {
    const window=await model(audio.slice(start*16000,(start+20)*16000),{return_timestamps:'word',chunk_length_s:20,stride_length_s:4});
    windows.push({start,duration:20,...window});
    for(const c of extractRadioClockCandidates(window.chunks,{streamId:'duke-tulane-windows',startSampleTime:start,sport:'football'})) {
      if(c.audioEndTime>start+20 || candidates.some(p=>p.clock===c.clock && Math.abs(p.audioTime-c.audioTime)<3)) continue;
      candidates.push(c);
    }
  }
  result={windows,candidates:associateRadioPeriods(candidates,{streamId:'duke-tulane-windows',sport:'football'})};
} else result=await model(audio,{return_timestamps:'word',chunk_length_s:25,stride_length_s:5});
await writeFile(output,JSON.stringify({model:'Xenova/whisper-base.en',duration:audio.length/16000,processingSeconds:(performance.now()-started)/1000,...result},null,2));
console.log(result.text || `Processed ${result.windows.length} streaming windows; ${result.candidates.length} clock candidates.`);
console.log(`Saved timestamped transcript to ${output}`);
await model.dispose();
