const MAX_RECEIPT_BYTES = 200 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function detectedType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  const ascii = (start, text) => [...text].every((char, index) => bytes[start + index] === char.charCodeAt(0));
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(0, '%PDF-')) return 'application/pdf';
  return null;
}

function fileName(name, jpeg = false) {
  const original = String(name || 'receipt').trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (jpeg) return `${original.replace(/\.[^.]+$/, '').slice(0, 116) || 'receipt'}.jpg`;
  return original.slice(0, 120) || 'receipt';
}

function dataUrl(bytes, type) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

async function decodedImage(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function jpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error()), 'image/jpeg', quality));
}

async function shrinkImage(bytes, type) {
  let image;
  try {
    image = await decodedImage(new Blob([bytes], { type }));
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    if (!width || !height || width * height > 36_000_000) throw new Error();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error();
    let scale = Math.min(1, 1800 / Math.max(width, height));
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.8, 0.7, 0.6]) {
        const blob = await jpegBlob(canvas, quality);
        if (blob.size <= MAX_RECEIPT_BYTES) return new Uint8Array(await blob.arrayBuffer());
      }
      scale *= 0.8;
    }
    throw new Error();
  } catch {
    throw new Error('无法处理这张图片，请换一张清晰的小尺寸图片。');
  } finally {
    image?.close?.();
  }
}

// Only local browser APIs are used; no receipt content leaves this page here.
export async function readReceiptFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isSafeInteger(file.size) || file.size < 1) {
    throw new Error('收据文件为空或无法读取。');
  }
  if (file.size > MAX_IMAGE_BYTES) throw new Error('图片不能超过 10 MB，PDF 不能超过 200 KB。');
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch { throw new Error('收据文件为空或无法读取。'); }
  const type = detectedType(bytes);
  if (!type || !TYPES.has(type) || file.type && file.type !== type) {
    throw new Error('请选择有效的 JPG、PNG、WebP 图片或 PDF 收据。');
  }
  if (type === 'application/pdf' && bytes.length > MAX_RECEIPT_BYTES) {
    throw new Error('PDF 不能超过 200 KB，请压缩后再添加。');
  }
  if (type.startsWith('image/') && bytes.length > MAX_RECEIPT_BYTES) {
    bytes = await shrinkImage(bytes, type);
    return { name: fileName(file.name, true), type: 'image/jpeg', size: bytes.length, dataUrl: dataUrl(bytes, 'image/jpeg') };
  }
  return { name: fileName(file.name), type, size: bytes.length, dataUrl: dataUrl(bytes, type) };
}

export function receiptBlob(receipt) {
  const invalid = () => new Error('收据文件无效，无法打开。');
  if (!receipt || !TYPES.has(receipt.type) || !Number.isSafeInteger(receipt.size) || receipt.size < 1 || receipt.size > MAX_RECEIPT_BYTES) throw invalid();
  const prefix = `data:${receipt.type};base64,`;
  if (typeof receipt.dataUrl !== 'string' || !receipt.dataUrl.startsWith(prefix)) throw invalid();
  const encoded = receipt.dataUrl.slice(prefix.length);
  if (encoded.length > 4 * Math.ceil(MAX_RECEIPT_BYTES / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw invalid();
  let bytes;
  try { bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)); }
  catch { throw invalid(); }
  if (bytes.length !== receipt.size || detectedType(bytes) !== receipt.type) throw invalid();
  return new Blob([bytes], { type: receipt.type });
}
