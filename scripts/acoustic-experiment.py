"""Exploratory offline content matching; scores are NOT verified sync accuracy.

Run with Python, numpy, scipy. Input WAVs: mono PCM at 8000 Hz.
All times are file positions. Removed commercials prohibit a single offset.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from scipy import signal, ndimage
from scipy.io import wavfile

FPS = 20
BANDS = [(80, 200), (200, 400), (400, 800), (800, 1200),
         (1200, 1800), (1800, 2500), (2500, 3500)]


def features(path):
    cache = path.with_suffix('.features.npz')
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            h.update(block)
    key = json.dumps({'wav_sha256': h.hexdigest(), 'fps': FPS,
                      'bands': BANDS, 'nfft': 512, 'version': 1}, sort_keys=True)
    if cache.exists():
        with np.load(cache, allow_pickle=False) as saved:
            if 'key' in saved and str(saved['key']) == key:
                return saved['features']
    sr, data = wavfile.read(path, mmap=True)
    assert sr == 8000 and data.ndim == 1 and data.dtype == np.int16
    hop, nfft = sr // FPS, 512
    result = []
    # Bound memory; align every chunk to the global feature grid.
    for start in range(0, len(data) - nfft + 1, hop * 1200):
        stop = min(start + hop * 1200 + nfft - hop, len(data))
        chunk = data[start:stop].astype(np.float32) / 32768
        _, _, spec = signal.stft(chunk, sr, nperseg=nfft, noverlap=nfft-hop,
                                boundary=None, padded=False)
        power = abs(spec) ** 2
        freqs = np.fft.rfftfreq(nfft, 1/sr)
        result.append(np.stack([np.log(1e-10 + power[(freqs >= lo) & (freqs < hi)].mean(axis=0))
                                for lo, hi in BANDS], axis=1))
    x = np.concatenate(result)
    np.savez_compressed(cache, features=x, key=key)
    return x


def whiten(x):
    # Offline discovery preprocessing only. Centered context is not a causal implementation.
    mean = ndimage.uniform_filter1d(x, size=200, axis=0, mode='nearest')
    var = ndimage.uniform_filter1d((x - mean)**2, size=200, axis=0, mode='nearest')
    return np.clip((x - mean) / np.sqrt(var + .1), -4, 4)


def scores(radio, query):
    n = len(query)
    q = query - query.mean(axis=0)
    prefix = np.vstack([np.zeros((1, radio.shape[1])), np.cumsum(radio, axis=0, dtype=np.float64)])
    prefix2 = np.vstack([np.zeros((1, radio.shape[1])), np.cumsum(radio**2, axis=0, dtype=np.float64)])
    var = prefix2[n:] - prefix2[:-n] - (prefix[n:] - prefix[:-n])**2 / n
    num = np.stack([signal.correlate(radio[:, i], q[:, i], mode='valid', method='fft')
                    for i in range(radio.shape[1])], axis=1)
    den = np.sqrt(np.maximum(var, 0) * (q*q).sum(axis=0))
    return np.divide(num, den, out=np.zeros_like(num), where=den > 1e-8).mean(axis=1)


def peaks(s, count=4):
    remaining = s.copy()
    result = []
    for _ in range(count):
        i = int(np.argmax(remaining))
        result.append({'radio_start_s': i/FPS, 'score': float(s[i])})
        remaining[max(0, i-10*FPS):i+10*FPS+1] = -np.inf
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument('tv', type=Path)
    p.add_argument('radio', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--starts', default='300,600,1200,1800,2400,3000,3300,3600,4200,4800,6000,7200')
    p.add_argument('--window', type=int, default=30)
    a = p.parse_args()
    t0 = time.time()
    tv, radio = whiten(features(a.tv)), whiten(features(a.radio))
    rows = []
    for start in map(float, a.starts.split(',')):
        query = tv[int(start*FPS):int((start+a.window)*FPS)]
        if len(query) != a.window*FPS:
            continue
        row = {'tv_start_s': start, 'duration_s': a.window, 'candidates': peaks(scores(radio, query))}
        rows.append(row)
        print(json.dumps(row), flush=True)
    output = {'status': 'EXPLORATORY_UNVERIFIED', 'limitations': [
        'Full-recording search uses future audio and is not a live test.',
        'A correlation peak is a candidate, not independently verified ground truth.',
        'Centered feature normalization is offline; streaming would need timestamped context.',
        'File-position differences are not measured live delays; TV commercials were removed.'
    ], 'feature_fps': FPS, 'bands_hz': BANDS, 'seconds': time.time()-t0, 'rows': rows}
    a.output.write_text(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
