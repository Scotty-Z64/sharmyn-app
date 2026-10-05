// Prepares a customer's proof of payment for upload: a screenshot/photo is
// shrunk to a sensible size (bank-app screenshots and phone photos are often
// several MB), a PDF is passed through as long as it's small enough. The server
// re-validates everything, this just keeps the upload fast on mobile data.

const MAX_PDF_BYTES = 3_000_000;
const MAX_DIMENSION = 1600;

export class ProofFileError extends Error {}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ProofFileError('Could not read that file — please try again.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ProofFileError('We could not open that image. Please upload a screenshot (JPG/PNG) or a PDF.'));
    };
    img.src = url;
  });
}

/** Returns a data URL (JPEG for images, the original for PDFs) ready for submitPaymentProof. */
export async function prepareProofFile(file: File): Promise<string> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) throw new ProofFileError('That PDF is too large (max about 3 MB). Please upload a screenshot instead.');
    return readAsDataUrl(file);
  }
  if (!file.type.startsWith('image/')) {
    throw new ProofFileError('Please upload a screenshot or photo (JPG/PNG) or a PDF.');
  }
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ProofFileError('Your browser could not process that image — please try a PDF.');
  ctx.fillStyle = '#ffffff'; // flatten transparency (PNG screenshots) onto white
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}
