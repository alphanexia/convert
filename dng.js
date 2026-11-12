// Alpha Converter — DNG / EXIF writer (TIFF-based), no dependencies.
// Writes an uncompressed 16-bit CFA DNG from LibRaw's raw mosaic: lossless.

const T = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEFINED: 7, SRATIONAL: 10 };
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 10: 8 };

function rat(v, den = 10000) {
  if (!isFinite(v)) v = 0;
  return [Math.round(v * den), den];
}
function expRat(v) {
  if (!(v > 0)) return [0, 1];
  if (v < 1) return [1, Math.round(1 / v)];
  return rat(v, 10);
}
function ascii(s) { return (s || '').replace(/[^\x20-\x7e]/g, '').trim(); }
function exifDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  const p = (n) => String(n).padStart(2, '0');
  // LibRaw timestamps are local camera time interpreted as epoch: use UTC fields.
  return `${d.getUTCFullYear()}:${p(d.getUTCMonth() + 1)}:${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// Serialize one IFD. entries: [{tag, type, values}] ; values array (numbers, [n,d] pairs) or string.
function ifdSize(entries) {
  let extra = 0;
  for (const e of entries) {
    const n = byteLen(e);
    if (n > 4) extra += n + (n & 1);
  }
  return 2 + entries.length * 12 + 4 + extra;
}
function count(e) {
  if (e.type === T.ASCII) return e.values.length + 1;
  if (e.type === T.RATIONAL || e.type === T.SRATIONAL) return e.values.length;
  return e.values.length;
}
function byteLen(e) { return count(e) * SIZE[e.type]; }

function writeIfd(dv, off, entries, nextIfd) {
  entries.sort((a, b) => a.tag - b.tag);
  let extraOff = off + 2 + entries.length * 12 + 4;
  dv.setUint16(off, entries.length, true);
  let p = off + 2;
  for (const e of entries) {
    const n = byteLen(e);
    dv.setUint16(p, e.tag, true);
    dv.setUint16(p + 2, e.type, true);
    dv.setUint32(p + 4, count(e), true);
    let w = p + 8;
    if (n > 4) { dv.setUint32(p + 8, extraOff, true); w = extraOff; extraOff += n + (n & 1); }
    else dv.setUint32(p + 8, 0, true);
    writeValues(dv, w, e);
    p += 12;
  }
  dv.setUint32(p, nextIfd, true);
  return extraOff;
}
function writeValues(dv, w, e) {
  const v = e.values;
  switch (e.type) {
    case T.ASCII:
      for (let i = 0; i < v.length; i++) dv.setUint8(w + i, v.charCodeAt(i));
      dv.setUint8(w + v.length, 0); break;
    case T.BYTE: case T.UNDEFINED: v.forEach((x, i) => dv.setUint8(w + i, x)); break;
    case T.SHORT: v.forEach((x, i) => dv.setUint16(w + i * 2, x, true)); break;
    case T.LONG: v.forEach((x, i) => dv.setUint32(w + i * 4, x >>> 0, true)); break;
    case T.RATIONAL: v.forEach(([a, b], i) => { dv.setUint32(w + i * 8, Math.max(0, a), true); dv.setUint32(w + i * 8 + 4, b, true); }); break;
    case T.SRATIONAL: v.forEach(([a, b], i) => { dv.setInt32(w + i * 8, a, true); dv.setInt32(w + i * 8 + 4, b, true); }); break;
  }
}

// Build a TIFF header + IFD0 (+ optional Exif IFD). Image data (if any) goes right after, at returned offset.
function buildTiff(ifd0, exif, imageBytes) {
  const EXIF_PTR = 34665, STRIP_OFF = 273;
  if (exif && exif.length) ifd0.push({ tag: EXIF_PTR, type: T.LONG, values: [0] });
  if (imageBytes != null) ifd0.push({ tag: STRIP_OFF, type: T.LONG, values: [0] });
  const s0 = ifdSize(ifd0);
  const sE = exif && exif.length ? ifdSize(exif) : 0;
  let total = 8 + s0 + sE;
  total += (16 - (total % 16)) % 16; // align pixel data
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  dv.setUint16(0, 0x4949, true); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
  const exifOff = 8 + s0;
  for (const e of ifd0) {
    if (e.tag === EXIF_PTR) e.values = [exifOff];
    if (e.tag === STRIP_OFF) e.values = [total];
  }
  writeIfd(dv, 8, ifd0, 0);
  if (sE) writeIfd(dv, exifOff, exif, 0);
  return buf;
}

function exifEntries(meta) {
  const e = [];
  const lens = ascii(meta.lens?.Lens || meta.lens?.makernotes?.Lens);
  if (meta.shutter > 0) e.push({ tag: 33434, type: T.RATIONAL, values: [expRat(meta.shutter)] });
  if (meta.aperture > 0) e.push({ tag: 33437, type: T.RATIONAL, values: [rat(meta.aperture, 10)] });
  if (meta.iso_speed > 0) e.push({ tag: 34855, type: T.SHORT, values: [Math.min(65535, Math.round(meta.iso_speed))] });
  e.push({ tag: 36864, type: T.UNDEFINED, values: [...'0231'].map((c) => c.charCodeAt(0)) });
  const d = exifDate(meta.timestamp);
  if (d) { e.push({ tag: 36867, type: T.ASCII, values: d }); e.push({ tag: 36868, type: T.ASCII, values: d }); }
  if (meta.focal_len > 0) e.push({ tag: 37386, type: T.RATIONAL, values: [rat(meta.focal_len, 10)] });
  if (lens) e.push({ tag: 42036, type: T.ASCII, values: lens });
  if (meta.lens?.LensSerial) e.push({ tag: 42037, type: T.ASCII, values: ascii(meta.lens.LensSerial) });
  return e;
}

// LibRaw flip -> EXIF orientation
export function orientationFromFlip(flip) {
  return { 0: 1, 3: 3, 5: 8, 6: 6 }[flip] || 1;
}

function cfaPattern(filters) {
  const fc = (r, c) => (filters >>> ((((r << 1) & 14) | (c & 1)) << 1)) & 3;
  const map = [0, 1, 2, 1]; // R G B G2 -> DNG plane colors
  const pat = [fc(0, 0), fc(0, 1), fc(1, 0), fc(1, 1)];
  for (let r = 2; r < 8; r++) for (let c = 0; c < 2; c++) if (fc(r, c) !== pat[(r & 1) * 2 + c]) return null;
  return pat.map((x) => map[x]);
}

// Estimate black level per CFA cell from the masked (optical black) border.
function estimateBlack(raw, fallback) {
  const { data, raw_width: W, top_margin: tm, left_margin: lm, height } = raw;
  // Median per CFA cell (robust to stray bright columns at the border).
  const hist = [0, 1, 2, 3].map(() => new Uint32Array(65536)), ns = [0, 0, 0, 0];
  const add = (r, c) => { const k = (((r - tm) & 1) << 1) | ((c - lm) & 1); hist[k][data[r * W + c]]++; ns[k]++; };
  if (lm >= 24) {
    for (let r = tm; r < tm + height; r += 3) for (let c = 8; c < lm - 8; c++) add(r, c);
  } else if (tm >= 24) {
    for (let r = 8; r < tm - 8; r++) for (let c = lm; c < lm + raw.width; c += 3) add(r, c);
  }
  if (!ns[0]) return [fallback, fallback, fallback, fallback];
  return hist.map((hst, i) => {
    let acc = 0; const half = ns[i] / 2;
    for (let v = 0; v < 65536; v++) { acc += hst[v]; if (acc >= half) return v; }
    return fallback;
  });
}

export class UnsupportedError extends Error {}

/**
 * meta: LibRaw metadata(true); raw: LibRaw rawImageData()
 * Returns a Blob (image/x-adobe-dng).
 */
export function buildDng(meta, raw) {
  const cd = meta.color_data || {};
  if (meta.is_foveon || meta.colors !== 3) throw new UnsupportedError('Capteur non Bayer');
  const cfa = cfaPattern(meta.filters >>> 0);
  if (!meta.filters || meta.filters < 1000 || !cfa) throw new UnsupportedError('Motif de capteur non pris en charge (ex. Fuji X-Trans)');

  const { width: w, height: h, raw_width: W, top_margin: tm, left_margin: lm } = raw;
  // Crop the visible area into a contiguous buffer.
  let pixels;
  if (lm === 0 && w === W) pixels = raw.data.subarray(tm * W, (tm + h) * W);
  else {
    pixels = new Uint16Array(w * h);
    for (let r = 0; r < h; r++) pixels.set(raw.data.subarray((r + tm) * W + lm, (r + tm) * W + lm + w), r * w);
  }

  const metaBlack = (cd.black || 0) + (cd.dng_levels?.dng_black || 0);
  const black = metaBlack > 0 ? [metaBlack, metaBlack, metaBlack, metaBlack] : estimateBlack(raw, 0);
  const white = cd.maximum > 0 ? cd.maximum : (1 << (cd.raw_bps || 14)) - 1;

  const cam = cd.cam_xyz || [];
  const hasMatrix = cam.length >= 3 && cam.slice(0, 3).some((row) => row.some((x) => x !== 0));
  let mul = cd.cam_mul && cd.cam_mul[0] > 0 ? cd.cam_mul : cd.pre_mul;
  const neutral = mul && mul[0] > 0 && mul[1] > 0 && mul[2] > 0
    ? [mul[1] / mul[0], 1, mul[1] / mul[2]] : [1, 1, 1];

  const make = ascii(meta.camera_make) || 'Unknown';
  const model = ascii(meta.camera_model) || 'Camera';
  const ucm = model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
  const date = exifDate(meta.timestamp);

  const ifd0 = [
    { tag: 254, type: T.LONG, values: [0] },
    { tag: 256, type: T.LONG, values: [w] },
    { tag: 257, type: T.LONG, values: [h] },
    { tag: 258, type: T.SHORT, values: [16] },
    { tag: 259, type: T.SHORT, values: [1] },
    { tag: 262, type: T.SHORT, values: [32803] },
    { tag: 271, type: T.ASCII, values: make },
    { tag: 272, type: T.ASCII, values: model },
    { tag: 274, type: T.SHORT, values: [orientationFromFlip(meta.flip)] },
    { tag: 277, type: T.SHORT, values: [1] },
    { tag: 278, type: T.LONG, values: [h] },
    { tag: 279, type: T.LONG, values: [w * h * 2] },
    { tag: 284, type: T.SHORT, values: [1] },
    { tag: 305, type: T.ASCII, values: 'Alpha Converter' },
    { tag: 33421, type: T.SHORT, values: [2, 2] },
    { tag: 33422, type: T.BYTE, values: cfa },
    { tag: 50706, type: T.BYTE, values: [1, 4, 0, 0] },
    { tag: 50707, type: T.BYTE, values: [1, 1, 0, 0] },
    { tag: 50708, type: T.ASCII, values: ucm },
    { tag: 50710, type: T.BYTE, values: [0, 1, 2] },
    { tag: 50711, type: T.SHORT, values: [1] },
    { tag: 50713, type: T.SHORT, values: [2, 2] },
    { tag: 50714, type: T.LONG, values: black },
    { tag: 50717, type: T.LONG, values: [white] },
    { tag: 50728, type: T.RATIONAL, values: neutral.map((x) => rat(x, 1000000)) },
  ];
  if (date) ifd0.push({ tag: 306, type: T.ASCII, values: date });
  if (hasMatrix) {
    ifd0.push({ tag: 50721, type: T.SRATIONAL, values: cam.slice(0, 3).flatMap((row) => row.slice(0, 3)).map((x) => rat(x)) });
    ifd0.push({ tag: 50778, type: T.SHORT, values: [21] }); // D65
  } else {
    // Generic sRGB-ish fallback so Lightroom can still open the file.
    const m = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.2040, 1.0570];
    ifd0.push({ tag: 50721, type: T.SRATIONAL, values: m.map((x) => rat(x)) });
    ifd0.push({ tag: 50778, type: T.SHORT, values: [21] });
  }
  const header = buildTiff(ifd0, exifEntries(meta), true);
  return new Blob([header, pixels], { type: 'image/x-adobe-dng' });
}

/** Minimal EXIF APP1 payload ("Exif\0\0" + TIFF) for JPEG output. */
export function buildExifApp1(meta) {
  const date = exifDate(meta.timestamp);
  const ifd0 = [
    { tag: 271, type: T.ASCII, values: ascii(meta.camera_make) || 'Unknown' },
    { tag: 272, type: T.ASCII, values: ascii(meta.camera_model) || 'Camera' },
    { tag: 274, type: T.SHORT, values: [1] },
    { tag: 305, type: T.ASCII, values: 'Alpha Converter' },
  ];
  if (date) ifd0.push({ tag: 306, type: T.ASCII, values: date });
  const tiff = new Uint8Array(buildTiff(ifd0, exifEntries(meta), null));
  const out = new Uint8Array(6 + tiff.length);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
  out.set(tiff, 6);
  return out;
}

/** Insert an APP1 segment right after SOI of a JPEG blob. */
export async function injectExif(jpegBlob, app1) {
  const head = new Uint8Array(await jpegBlob.slice(0, 2).arrayBuffer());
  if (head[0] !== 0xff || head[1] !== 0xd8 || app1.length > 65000) return jpegBlob;
  const seg = new Uint8Array(4 + app1.length);
  seg[0] = 0xff; seg[1] = 0xe1; seg[2] = (app1.length + 2) >> 8; seg[3] = (app1.length + 2) & 0xff;
  seg.set(app1, 4);
  return new Blob([head, seg, jpegBlob.slice(2)], { type: 'image/jpeg' });
}
