// A quiet tone at each second, with a higher tone every fifth second.
export function demoURL() {
  const rate = 16000, seconds = 30, count = rate * seconds;
  const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  const word = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const t = i / rate, fraction = t % 1, frequency = Math.floor(t) % 5 === 0 ? 880 : 440;
    const envelope = fraction < 0.12 ? Math.sin(Math.PI * fraction / 0.12) * 0.18 : 0;
    view.setInt16(44 + i * 2, Math.sin(t * frequency * Math.PI * 2) * envelope * 32767, true);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}
