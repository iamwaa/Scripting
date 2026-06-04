const qrImageCache = new Map<string, any>();

export async function getQrImage(content: string) {
  if (qrImageCache.has(content)) return qrImageCache.get(content);
  const image = await QRCode.generate(content);
  if (image) qrImageCache.set(content, image);
  return image;
}
