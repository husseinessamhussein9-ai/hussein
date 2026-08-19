function findDurationOffset(bytes) {
  const limit = Math.min(bytes.length - 10, 200000);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0x44 && bytes[i + 1] === 0x89) return i;
  }
  return -1;
}

function writeFloat64BE(bytes, offset, value) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, false);
  bytes.set(new Uint8Array(buf), offset);
}

export async function ensureWebmDuration(blob, durationMs) {
  if (!blob || !blob.size) return blob;
  if (!String(blob.type || "").includes("webm")) return blob;
  try {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf.slice(0));
    const at = findDurationOffset(bytes);
    if (at < 0) return new Blob([bytes], { type: blob.type });
    let p = at + 2;
    const sizeLen = 8 - Math.clz32(bytes[p]) + 1;
    if (sizeLen < 1 || sizeLen > 8 || p + sizeLen >= bytes.length) return blob;
    const dataStart = p + sizeLen;
    const dataLen = sizeLen === 1 ? (bytes[p] & 0x7f) : 8;
    if (dataLen === 8 && dataStart + 8 <= bytes.length) {
      writeFloat64BE(bytes, dataStart, durationMs);
    } else if (dataLen === 4 && dataStart + 4 <= bytes.length) {
      const f = new ArrayBuffer(4);
      new DataView(f).setFloat32(0, durationMs, false);
      bytes.set(new Uint8Array(f), dataStart);
    }
    return new Blob([bytes], { type: blob.type || "video/webm" });
  } catch {
    return blob;
  }
}

export function saveBlob(blob, filename) {
  if (!blob) throw new Error("مفيش ملف يتحمّل");
  if (navigator.msSaveOrOpenBlob) {
    navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 4000);
}
