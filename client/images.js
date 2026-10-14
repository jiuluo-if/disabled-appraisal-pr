export async function prepareImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请上传JPEG、PNG或WebP格式的报告图片。');
  if (file.size > 12 * 1024 * 1024) throw new Error('单张图片超过12MB，请压缩后上传。');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('图片无法读取，请重新选择清晰的报告图片。'); }
  try {
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    if (dataUrl.length > 8 * 1024 * 1024) throw new Error('图片压缩后仍过大，请裁剪报告正文后上传。');
    return { id: crypto.randomUUID(), name: file.name.slice(0, 200), mimeType: 'image/jpeg',
      data: dataUrl.slice(dataUrl.indexOf(',') + 1), preview: dataUrl,
      width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); }
}
