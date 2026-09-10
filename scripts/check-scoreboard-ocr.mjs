import {createWorker} from 'tesseract.js';
import sharp from 'sharp';
import {writeFile,mkdir} from 'node:fs/promises';
import {parseScoreboard} from '../src/scoreboard.js';
await mkdir('/private/tmp/mystream-ocr',{recursive:true});
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="150"><rect width="1100" height="150" fill="#101725"/><text x="30" y="95" fill="white" font-family="Arial" font-size="58" font-weight="bold">DUKE 7   TULANE 0   Q2   1:38</text></svg>';
const png=await sharp(Buffer.from(svg)).png().toBuffer();
const worker=await createWorker('eng',1,{cachePath:'/private/tmp/mystream-ocr'});
try {
 await worker.setParameters({tessedit_pageseg_mode:'11'});
 const {data}=await worker.recognize(png);
 const result={fixture:'synthetic scoreboard; not a TV-camera accuracy test',text:data.text,confidence:data.confidence,parsed:parseScoreboard(data.text)};
 await writeFile(new URL('../output/scoreboard-ocr-check.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
 if(result.parsed.state!=='read' || result.parsed.clock!==98 || result.parsed.period!==2) process.exitCode=1;
} finally {await worker.terminate();}
