"""Local feasibility checks around an independently identified second-quarter play.

This evaluates direct broadcast audio, not a microphone recording. The reference
was identified by matching penalty/play descriptions in separate transcripts and
viewing the TV referee; shared PA waveform refines that reference. It is NOT an
independent millisecond timing measurement for the entire interval.
"""
import hashlib
import json
import argparse
from pathlib import Path
import time
import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/acoustic-test'
RATE = 8000
FILTER = None


def ncc(r, q):
    q = q - q.mean()
    n = len(q)
    c = signal.correlate(r, q, mode='valid', method='fft')
    s = np.r_[0., np.cumsum(r, dtype=np.float64)]
    s2 = np.r_[0., np.cumsum(r*r, dtype=np.float64)]
    den = np.sqrt(np.maximum(s2[n:]-s2[:-n]-(s[n:]-s[:-n])**2/n, 0) * (q*q).sum())
    return np.divide(c, den, out=np.zeros_like(c), where=den > 1e-10)


def samples(data, start, length):
    first, last = round(start*RATE), round((start+length)*RATE)
    if first < 0 or last > len(data) or last <= first:
        raise ValueError('Requested window is outside available audio')
    if FILTER is None:
        return data[first:last].astype(np.float64)/32768
    # Warm up the causal filter using actual preceding samples.
    warm = max(0, first-RATE)
    x = data[warm:last].astype(np.float64)/32768
    return signal.sosfilt(FILTER, x)[first-warm:]


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024), b''): h.update(b)
    return h.hexdigest()


def main():
    global FILTER
    parser=argparse.ArgumentParser()
    parser.add_argument('--bandstop',action='store_true')
    args=parser.parse_args()
    if args.bandstop:
        FILTER=signal.butter(6,[300,3000],btype='bandstop',fs=RATE,output='sos')
    tv_rate, tv = wavfile.read(OUT/'tv-8k.wav', mmap=True)
    radio_rate, radio = wavfile.read(OUT/'radio-8k.wav', mmap=True)
    for rate, data in [(tv_rate,tv),(radio_rate,radio)]:
        if rate != RATE or data.ndim != 1 or data.dtype != np.int16:
            raise ValueError('Expected 8000 Hz mono PCM16 WAV')
    anchors = []
    for start in [3198, 3200, 3202]:
        c = ncc(samples(radio, 15020, 50), samples(tv, start, 4))
        i = int(np.argmax(c))
        anchors.append({'tv_start_s':start, 'radio_start_s':15020+i/RATE,
                        'file_offset_s':15020+i/RATE-start, 'ncc':float(c[i])})
    offset = float(np.median([x['file_offset_s'] for x in anchors]))
    rows=[]
    # Freeze a deliberately conservative exploratory threshold, without claiming
    # calibration or generalization. Include the PA calibration interval explicitly.
    threshold=.30
    for start in [3200, 3230, 3265, 3320, 3370, 3400]:
        for duration in [5, 10, 20]:
            for injected_delay in [5, 30, 90, 150]:
                for wrong_history in [False, True]:
                    # Reference-based synthetic arrival timeline, not observed wall time.
                    radio_end=start+duration+offset+injected_delay
                    history_start=radio_end-180 + (600 if wrong_history else 0)
                    t0=time.perf_counter()
                    c=ncc(samples(radio,history_start,180), samples(tv,start,duration))
                    i=int(np.argmax(c)); second=c.copy()
                    second[max(0,i-RATE):i+RATE+1]=-np.inf
                    best=float(c[i]); delay=180-duration-i/RATE
                    rows.append({'tv_start_s':start, 'duration_s':duration,
                        'calibration_event':start==3200, 'injected_delay_s':injected_delay,
                        'wrong_history':wrong_history, 'ncc':best,
                        'competing_peak':float(np.max(second)), 'candidate_delay_s':delay,
                        'candidate_error_s':None if wrong_history else delay-injected_delay,
                        'accepted_exploratorily':best>=threshold,
                        'compute_seconds':time.perf_counter()-t0})
        print('Completed TV',start,flush=True)
    summary=[]
    for group in ['calibration', 'ordinary_play', 'negative']:
        rr=[r for r in rows if (r['wrong_history'] if group=='negative' else
            not r['wrong_history'] and r['calibration_event']==(group=='calibration'))]
        accepted=[r for r in rr if r['accepted_exploratorily']]
        summary.append({'group':group,'trials':len(rr),'accepted':len(accepted),
                        'peak_ncc':max(r['ncc'] for r in rr)})
    report={'status':'LIMITED_FEASIBILITY_TEST', 'threshold':threshold,
        'mode':'bandstop_300_3000' if args.bandstop else 'raw_pcm',
        'source_hashes':{str(p.relative_to(ROOT)):digest(p) for p in [ROOT/'tulane.mp4',OUT/'duke-tulane-radio.mp3']},
        'artifact_hashes':{str(p.relative_to(ROOT)):digest(p) for p in [
            Path(__file__), ROOT/'scripts/acoustic-experiment.py', OUT/'tv-8k.wav',OUT/'radio-8k.wav']},
        'decode_arguments':['-vn','-ac','1','-ar','8000','-c:a','pcm_s16le'],
        'reference_anchors':anchors,'summary':summary,'rows':rows,
        'limitations':['Only one local second-quarter interval; no whole-game accuracy claim.',
          'Overlapping PA anchors describe one event, not three independent successes.',
          'Offsets outside PA event assume continuity supported by play descriptions, not independent subsecond ground truth.',
          'Ordinary-play abstentions do not require subsecond ground truth to establish lack of confident lock.',
          'Delay is injected; commercial-free file offsets do not measure live delay.',
          'Buffers are warm and features are raw PCM; no microphone, room, speaker feedback, cold-start or live network test.',
          'Repeated injected delays reuse content and are not independent samples.',
          'Threshold is exploratory and not calibrated for production.']}
    (OUT/('filtered-validation.json' if args.bandstop else 'local-validation.json')).write_text(json.dumps(report,indent=2))
    print(json.dumps(summary),flush=True)


if __name__=='__main__':main()
