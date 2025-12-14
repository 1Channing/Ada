import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface ExportToPdfOptions {
  brand?: string;
  model?: string;
  year?: number;
  trim?: string | null;
  imageUrls?: string[];
  sourceTrim?: string | null;
}

function normalizeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url.split('?')[0];
  }
}

function getImageQualityScore(url: string): number {
  const lower = url.toLowerCase();

  if (lower.includes('rule=xxl')) return 4;
  if (lower.includes('rule=ad-large')) return 3;
  if (lower.includes('rule=ad-image')) return 2;
  if (lower.includes('rule=ad-thumb')) return 0;

  return 1;
}

function deduplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    if (!seen.has(url)) {
      seen.add(url);
      result.push(url);
    }
  }
  return result;
}

function createImagePageContainer(
  imageUrl: string,
  title: string | null,
  includeTitle: boolean
): HTMLElement {
  const container = document.createElement('div');
  container.style.width = '210mm';
  container.style.minHeight = '297mm';
  container.style.backgroundColor = '#ffffff';
  container.style.padding = '15mm 15mm 25mm 15mm';
  container.style.fontFamily = 'Arial, sans-serif';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'center';
  container.style.justifyContent = includeTitle ? 'flex-start' : 'center';
  container.style.position = 'relative';

  const styleElement = document.createElement('style');
  styleElement.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300&display=swap');
  `;
  container.appendChild(styleElement);

  if (includeTitle && title) {
    const titleElement = document.createElement('h1');
    titleElement.textContent = title;
    titleElement.style.fontSize = '28pt';
    titleElement.style.fontWeight = '300';
    titleElement.style.fontFamily = "'Montserrat', sans-serif";
    titleElement.style.margin = '0 0 15mm 0';
    titleElement.style.color = '#1a1a1a';
    titleElement.style.textAlign = 'center';
    titleElement.style.width = '100%';
    container.appendChild(titleElement);
  }

  const imgElement = document.createElement('img');
  imgElement.src = imageUrl;
  imgElement.crossOrigin = 'anonymous';
  imgElement.style.maxWidth = '100%';
  imgElement.style.maxHeight = includeTitle ? 'calc(100% - 70mm)' : 'calc(100% - 20mm)';
  imgElement.style.objectFit = 'contain';
  imgElement.style.display = 'block';

  container.appendChild(imgElement);

  const logoElement = document.createElement('img');
  logoElement.src = '/mc-export-logo.svg';
  logoElement.style.position = 'absolute';
  logoElement.style.bottom = '8mm';
  logoElement.style.left = '50%';
  logoElement.style.transform = 'translateX(-50%)';
  logoElement.style.height = '12mm';
  logoElement.style.objectFit = 'contain';

  container.appendChild(logoElement);

  return container;
}

async function loadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

export async function exportListingToPdf(
  _containerElement: HTMLElement | null,
  options: ExportToPdfOptions = {}
): Promise<void> {
  try {
    const { brand, model, year, imageUrls = [], sourceTrim } = options;

    let title = brand && model
      ? `${brand} ${model}${year ? ` ${year}` : ''}`
      : 'Vehicle Listing';

    if (sourceTrim && sourceTrim.trim()) {
      title += ` ${sourceTrim.toUpperCase()}`;
    }

    const rawImageUrls = imageUrls;

    type ImageChoice = { url: string; score: number };

    const bestByKey = new Map<string, ImageChoice>();

    for (const url of rawImageUrls) {
      const key = normalizeImageUrl(url);
      const score = getImageQualityScore(url);
      const existing = bestByKey.get(key);

      if (!existing || score > existing.score) {
        bestByKey.set(key, { url, score });
      }
    }

    const uniqueImageUrls = Array.from(bestByKey.values()).map((v) => v.url);

    console.log('[PDF_EXPORT_DEBUG] Raw image count:', rawImageUrls.length);
    console.log('[PDF_EXPORT_DEBUG] Unique image count:', uniqueImageUrls.length);
    console.log(
      '[PDF_EXPORT_DEBUG] Chosen image URLs:',
      uniqueImageUrls.map((u) => u.substring(0, 80) + '...')
    );

    if (uniqueImageUrls.length === 0) {
      console.warn('[PDF_EXPORT] No images available, creating fallback PDF');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      pdf.setFontSize(28);
      pdf.text(title, pageWidth / 2, 30, { align: 'center' });
      pdf.setFontSize(12);
      pdf.setTextColor(156, 163, 175);
      pdf.text('No images available', pageWidth / 2, pageHeight / 2, { align: 'center' });

      const fileName = buildFileName(options);
      pdf.save(fileName);
      console.log('[PDF_EXPORT] Fallback PDF saved');
      return;
    }

    console.log('[PDF_EXPORT] Starting PDF generation with multiple image pages...');

    const hiddenContainer = document.createElement('div');
    hiddenContainer.style.position = 'absolute';
    hiddenContainer.style.left = '-9999px';
    hiddenContainer.style.top = '0';
    document.body.appendChild(hiddenContainer);

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;

    let pagesAdded = 0;

    for (let i = 0; i < uniqueImageUrls.length; i++) {
      const imageUrl = uniqueImageUrls[i];
      const isFirstPage = i === 0;

      console.log(`[PDF_EXPORT_DEBUG] Processing image ${i + 1}/${uniqueImageUrls.length}: ${imageUrl.slice(0, 80)}...`);

      const canLoad = await loadImage(imageUrl);
      if (!canLoad) {
        console.warn(`[PDF_EXPORT_DEBUG] Failed to load image ${i + 1}, skipping: ${imageUrl.slice(0, 80)}...`);
        continue;
      }

      const pageContainer = createImagePageContainer(imageUrl, title, isFirstPage);
      hiddenContainer.appendChild(pageContainer);

      await new Promise(resolve => setTimeout(resolve, 300));

      try {
        const canvas = await html2canvas(pageContainer, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: '#ffffff',
        });

        if (pagesAdded > 0) {
          pdf.addPage();
        }

        const imgData = canvas.toDataURL('image/png');
        const canvasAspectRatio = canvas.width / canvas.height;
        const pageAspectRatio = pageWidth / pageHeight;

        let finalWidth: number;
        let finalHeight: number;

        if (canvasAspectRatio > pageAspectRatio) {
          finalWidth = pageWidth;
          finalHeight = pageWidth / canvasAspectRatio;
        } else {
          finalHeight = pageHeight;
          finalWidth = pageHeight * canvasAspectRatio;
        }

        const x = (pageWidth - finalWidth) / 2;
        const y = (pageHeight - finalHeight) / 2;

        pdf.addImage(imgData, 'PNG', x, y, finalWidth, finalHeight, undefined, 'FAST');
        pagesAdded++;

        console.log(`[PDF_EXPORT_DEBUG] Added page ${pagesAdded} with image`);

        hiddenContainer.removeChild(pageContainer);
      } catch (error) {
        console.error(`[PDF_EXPORT_DEBUG] Error capturing image ${i + 1}:`, error);
        hiddenContainer.removeChild(pageContainer);
      }
    }

    document.body.removeChild(hiddenContainer);

    if (pagesAdded === 0) {
      console.warn('[PDF_EXPORT] No images could be rendered, creating fallback PDF');
      pdf.setFontSize(28);
      pdf.text(title, pageWidth / 2, 30, { align: 'center' });
      pdf.setFontSize(12);
      pdf.setTextColor(156, 163, 175);
      pdf.text('No images could be loaded', pageWidth / 2, pageHeight / 2, { align: 'center' });
    }

    const fileName = buildFileName(options);
    console.log(`[PDF_EXPORT_DEBUG] Added ${pagesAdded} pages with images for listing`);
    console.log(`[PDF_EXPORT] Saving PDF as: ${fileName}`);
    pdf.save(fileName);

    console.log('[PDF_EXPORT] PDF saved successfully');
  } catch (error) {
    console.error('[PDF_EXPORT] Error generating PDF:', error);
    throw error;
  }
}

function buildFileName(options: ExportToPdfOptions): string {
  const { brand, model, year, trim } = options;
  let fileName = 'listing';

  if (brand && model) {
    fileName = `${brand}_${model}`;
    if (year) {
      fileName += `_${year}`;
    }
    if (trim) {
      fileName += `_${trim}`;
    }
  }

  const safeName = fileName
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .toUpperCase();

  return `${safeName}.pdf`;
}
