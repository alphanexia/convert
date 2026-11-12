// Alpha Converter — conversion core (runs fully in the browser).
import LibRaw from './libraw-index.js';
import { buildDng, buildExifApp1, injectExif } from './dng.js';

export const RAW_EXT = ['cr3', 'cr2', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'rwl', 'pef', 'srw', 'dng', '3fr', 'fff', 'iiq', 'erf', 'mos', 'mrw', 'kdc', 'dcr', 'x3f'];

const baseName = (name) => name.replace(/\.[^.]+$/, '');

async function withLibRaw(bytes, settings, fn) {
  const raw = new LibRaw();
  try {
    await raw.open(bytes, settings);
    return await fn(raw);
  } finally {
    raw.dispose();
  }
}

export async function toDng(file, onStep = () => {}) {
  onStep('Lecture du fichier');
  const bytes = new Uint8Array(await file.arrayBuffer());
  onStep('Décodage du RAW');
  return withLibRaw(bytes, {}, async (raw) => {
    const meta = await raw.metadata(true);
    const sensor = await raw.rawImageData();
    if (!sensor?.data) throw new Error('Impossible de lire les données du capteur');
    onStep('Écriture du DNG');
    const blob = buildDng(meta, sensor);
    return { blob, name: baseName(file.name) + '.dng', meta };
  });
}

function rgbToImageData(img) {
  const { width, height, data, colors } = img;
  const out = new Uint8ClampedArray(width * height * 4);
  if (colors === 3) {
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      out[j] = data[i]; out[j + 1] = data[i + 1]; out[j + 2] = data[i + 2]; out[j + 3] = 255;
    }
  } else {
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      out[j] = out[j + 1] = out[j + 2] = data[i]; out[j + 3] = 255;
    }
  }
  return new ImageData(out, width, height);
}

async function encodeJpeg(imageData, quality) {
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(imageData.width, imageData.height)
      : Object.assign(document.createElement('canvas'), { width: imageData.width, height: imageData.height });
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.putImageData(imageData, 0, 0);
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
      : await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size < 1000) throw new Error('canvas too large');
    return blob;
  } catch {
    // Fallback for browsers with small canvas limits (e.g. iPhone): pure JS encoder.
    const { default: encode } = await import('./jpeg-encoder.js');
    const res = encode({ width: imageData.width, height: imageData.height, data: imageData.data }, Math.round(quality * 100));
    return new Blob([res.data], { type: 'image/jpeg' });
  }
}

export async function toJpeg(file, { quality = 0.92 } = {}, onStep = () => {}) {
  onStep('Lecture du fichier');
  const bytes = new Uint8Array(await file.arrayBuffer());
  onStep('Développement du RAW');
  const settings = { useCameraWb: true, outputBps: 8, outputColor: 1, userQual: 3, highlight: 0 };
  // First build a clean DNG (fixes black level / colour data for recent bodies),
  // then develop that DNG. Falls back to developing the original file directly.
  let source = bytes, meta;
  try {
    const dng = await withLibRaw(bytes, {}, async (raw) => {
      meta = await raw.metadata(true);
      return buildDng(meta, await raw.rawImageData());
    });
    source = new Uint8Array(await dng.arrayBuffer());
  } catch { source = bytes; }
  return withLibRaw(source, settings, async (raw) => {
    meta = meta || await raw.metadata(true);
    const img = await raw.imageData();
    if (!img?.data) throw new Error('Impossible de développer cette image');
    onStep('Encodage JPG');
    let blob = await encodeJpeg(rgbToImageData(img), quality);
    blob = await injectExif(blob, buildExifApp1(meta));
    return { blob, name: baseName(file.name) + '.jpg', meta };
  });
}
