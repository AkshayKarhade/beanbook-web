// White-label printable menu QR card. Render from verified published menu data.
// The image includes the canonical production URL (never a temporary Netlify preview URL).
export type MenuQrCardData = {
  businessName: string;
  menuName: string;
  menuType: 'regular' | 'event';
  location: string | null;
  url: string;
};

export const menuPublicUrl = (menuId: string) =>
  'https://the8thcoffeebean.com/beanbook/menu/' + encodeURIComponent(menuId);

const slug = (value: string) =>
  value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'menu';

function fittedText(
  ctx: CanvasRenderingContext2D,
  value: string,
  y: number,
  maxWidth: number,
  fontSize: number,
  weight: number,
  color: string
) {
  const text = value.trim();
  let size = fontSize;
  do {
    ctx.font = weight + ' ' + size + 'px system-ui, -apple-system, sans-serif';
    if (ctx.measureText(text).width <= maxWidth || size <= 27) break;
    size -= 2;
  } while (true);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 600, y, maxWidth);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export async function downloadMenuQrCard(data: MenuQrCardData, qrCanvas: HTMLCanvasElement): Promise<void> {
  if (!data.businessName.trim() || !data.menuName.trim() || !qrCanvas.width) {
    throw new Error('Menu QR card is not ready yet. Reload and try again.');
  }

  const poster = document.createElement('canvas');
  poster.width = 1200;
  poster.height = 1600;
  const ctx = poster.getContext('2d');
  if (!ctx) throw new Error('Your browser cannot create a PNG card.');

  // A4-friendly portrait proportions, generous whitespace and a clean QR quiet zone.
  ctx.fillStyle = '#f5f3ef';
  ctx.fillRect(0, 0, 1200, 1600);
  roundedRect(ctx, 75, 65, 1050, 1470, 36);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.fillStyle = '#1b2822';
  roundedRect(ctx, 520, 132, 160, 9, 4);
  ctx.fill();

  fittedText(ctx, data.businessName, 240, 920, 73, 750, '#1b2822');
  fittedText(ctx, data.menuName, 345, 920, 59, 650, '#334139');
  fittedText(ctx, data.menuType === 'regular' ? 'REGULAR MENU' : 'EVENT MENU', 428, 900, 27, 700, '#64736a');

  roundedRect(ctx, 163, 492, 874, 874, 28);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e8e9e5';
  ctx.lineWidth = 3;
  ctx.stroke();

  // QR image contains its own 4-module white quiet zone; never crop it.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrCanvas, 203, 532, 794, 794);
  ctx.imageSmoothingEnabled = true;

  fittedText(ctx, 'SCAN TO VIEW MENU', 1431, 930, 43, 800, '#1b2822');
  if (data.location?.trim()) fittedText(ctx, data.location, 1490, 930, 27, 500, '#6b756e');

  const blob = await new Promise<Blob>((resolve, reject) => {
    poster.toBlob(value => value ? resolve(value) : reject(new Error('Could not export PNG.')), 'image/png');
  });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = slug(data.businessName) + '-' + slug(data.menuName) + '-qr.png';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Release the blob after the browser has had a chance to start the download.
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
}
