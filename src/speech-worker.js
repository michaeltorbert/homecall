import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels=false;
let transcriber;
self.onmessage=async({data})=>{
  try {
    if(data.type==='load') {
      transcriber ||= await pipeline('automatic-speech-recognition','Xenova/whisper-base.en',{
        dtype:'q8',device:'wasm',progress_callback:p=>{
          if(p.status==='progress') self.postMessage({type:'progress',progress:Math.round(p.progress)});
        }
      });
      self.postMessage({type:'ready'});
    }
    if(data.type==='transcribe' && transcriber) {
      const result=await transcriber(data.samples,{return_timestamps:'word',chunk_length_s:20,stride_length_s:4});
      self.postMessage({type:'transcript',duration:data.samples.length/16000,chunks:result.chunks,text:result.text,startSampleTime:data.startSampleTime,streamId:data.streamId});
    }
  } catch(error) { self.postMessage({type:'error',message:error.message}); }
};
