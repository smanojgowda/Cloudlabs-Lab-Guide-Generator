/**
 * Screenshot capture + Sharp image processing
 *
 * Responsibilities:
 * 1. Full-page screenshot capture
 * 2. Dynamic sidebar detection and cropping
 * 3. Numbered annotation overlays (red rectangles + numbered circles)
 * 4. Bounding box adjustment after crop + HiDPI scale
 * 5. Save processed image to disk
 */
import sharp from 'sharp';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import config from '../config.js';
import logger from '../utils/logger.js';
import { detectSidebar } from '../utils/dom-helpers.js';

/**
 * Capture a screenshot, crop sidebar, and draw numbered annotations.
 *
 * @param {import('playwright').Page} page - Playwright page
 * @param {Array<{boundingBox: {x,y,width,height}, number: number}>|null} annotations
 *   Array of elements to annotate with numbered labels, or null for clean screenshot
 * @param {string} filename - output filename (e.g. "step-01.png")
 * @returns {Promise<{path: string, relativePath: string, width: number, height: number}>}
 */
export async function captureAndProcess(page, annotations, filename) {
  // 1. Take full-page screenshot as buffer
  const rawBuffer = await page.screenshot({ type: 'png', fullPage: false });
  logger.debug(`Raw screenshot captured: ${rawBuffer.length} bytes`);

  // 2. Detect sidebar dimensions
  let sidebar = { found: false, width: 0 };
  try {
    sidebar = await detectSidebar(page);
  } catch { /* page may be navigating */ }
  logger.debug(`Sidebar detection: ${JSON.stringify(sidebar)}`);

  // 3. Get viewport dimensions
  const viewportSize = page.viewportSize();
  const vpWidth = viewportSize?.width || config.browser.viewport.width;
  const vpHeight = viewportSize?.height || config.browser.viewport.height;

  // 4. Determine crop region (remove sidebar from left)
  const cropX = sidebar.found ? Math.ceil(sidebar.width) : 0;
  const cropWidth = vpWidth - cropX;

  // 5. Crop the image
  const metadata = await sharp(rawBuffer).metadata();
  const imgWidth = metadata.width || vpWidth;
  const imgHeight = metadata.height || vpHeight;

  const scaleX = imgWidth / vpWidth;
  const scaleY = imgHeight / vpHeight;

  const extractRegion = {
    left: Math.max(0, Math.round(cropX * scaleX)),
    top: 0,
    width: Math.min(Math.round(cropWidth * scaleX), imgWidth),
    height: imgHeight,
  };
  extractRegion.width = Math.min(extractRegion.width, imgWidth - extractRegion.left);

  let image = sharp(rawBuffer).extract(extractRegion);

  // 6. Draw numbered annotations if provided
  if (annotations && annotations.length > 0) {
    const croppedBuffer = await image.png().toBuffer();
    const croppedMeta = await sharp(croppedBuffer).metadata();
    const cw = croppedMeta.width;
    const ch = croppedMeta.height;

    const pad = config.screenshot.highlightPadding;
    const stroke = config.screenshot.highlightStroke;
    const { r, g, b } = config.screenshot.highlightColor;

    // Build annotation rects for SVG
    const rects = [];
    for (const ann of annotations) {
      if (!ann.boundingBox) continue;
      let hlX = Math.round((ann.boundingBox.x - cropX) * scaleX) - pad;
      let hlY = Math.round(ann.boundingBox.y * scaleY) - pad;
      let hlW = Math.round(ann.boundingBox.width * scaleX) + pad * 2;
      let hlH = Math.round(ann.boundingBox.height * scaleY) + pad * 2;

      hlX = Math.max(0, hlX);
      hlY = Math.max(0, hlY);
      hlW = Math.min(hlW, cw - hlX);
      hlH = Math.min(hlH, ch - hlY);

      if (hlW > 0 && hlH > 0) {
        rects.push({ x: hlX, y: hlY, w: hlW, h: hlH, number: ann.number });
      }
    }

    if (rects.length > 0) {
      const svgOverlay = buildAnnotationSVG(cw, ch, rects, stroke, r, g, b);
      image = sharp(croppedBuffer).composite([
        { input: Buffer.from(svgOverlay), top: 0, left: 0 },
      ]);
    } else {
      image = sharp(croppedBuffer);
    }
  }

  // 7. Optimize and save
  const outputPath = resolve(config.paths.screenshots, filename);
  const finalBuffer = await image
    .png({ quality: config.screenshot.quality, compressionLevel: 2 })
    .toBuffer();

  writeFileSync(outputPath, finalBuffer);

  const finalMeta = await sharp(finalBuffer).metadata();
  logger.info(`Screenshot saved: ${filename} (${finalMeta.width}x${finalMeta.height})`);

  return {
    path: outputPath,
    relativePath: `screenshots/${filename}`,
    width: finalMeta.width,
    height: finalMeta.height,
  };
}

/**
 * Build an SVG overlay with numbered annotations:
 * - Red rectangle around each element
 * - Red circle with white number at top-right corner
 */
function buildAnnotationSVG(canvasW, canvasH, rects, strokeWidth, r, g, b) {
  const circleR = 16;
  let shapes = '';

  for (const rect of rects) {
    // Red rectangle outline
    shapes += `  <rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}"
        fill="none" stroke="rgb(${r},${g},${b})" stroke-width="${strokeWidth}" rx="3" ry="3"/>\n`;

    // Number circle at top-right corner of rectangle
    const cx = Math.min(rect.x + rect.w + circleR - 4, canvasW - circleR - 2);
    const cy = Math.max(rect.y - circleR + 4, circleR + 2);

    shapes += `  <circle cx="${cx}" cy="${cy}" r="${circleR}" fill="rgb(${r},${g},${b})"/>\n`;
    shapes += `  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" `
            + `font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="white">`
            + `${rect.number}</text>\n`;
  }

  return `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">\n${shapes}</svg>`;
}

/**
 * Capture a clean screenshot without any annotations (for overview/initial shots)
 */
export async function captureClean(page, filename) {
  return captureAndProcess(page, null, filename);
}

/**
 * Process a raw PNG buffer: draw annotations and save to disk.
 * Used by desktop mode where screenshots come from Electron's capturePage() instead of Playwright.
 *
 * @param {Buffer} rawBuffer - raw PNG screenshot buffer
 * @param {Array<{boundingBox: {x,y,width,height}, number: number}>|null} annotations
 * @param {string} filename - output filename
 * @returns {Promise<{path: string, relativePath: string, width: number, height: number}>}
 */
export async function annotateBuffer(rawBuffer, annotations, filename) {
  const metadata = await sharp(rawBuffer).metadata();
  const imgWidth = metadata.width;
  const imgHeight = metadata.height;
  let image = sharp(rawBuffer);

  if (annotations && annotations.length > 0) {
    const pad = config.screenshot.highlightPadding;
    const stroke = config.screenshot.highlightStroke;
    const { r, g, b } = config.screenshot.highlightColor;

    const rects = [];
    for (const ann of annotations) {
      if (!ann.boundingBox) continue;
      let hlX = Math.round(ann.boundingBox.x) - pad;
      let hlY = Math.round(ann.boundingBox.y) - pad;
      let hlW = Math.round(ann.boundingBox.width) + pad * 2;
      let hlH = Math.round(ann.boundingBox.height) + pad * 2;

      hlX = Math.max(0, hlX);
      hlY = Math.max(0, hlY);
      hlW = Math.min(hlW, imgWidth - hlX);
      hlH = Math.min(hlH, imgHeight - hlY);

      if (hlW > 0 && hlH > 0) {
        rects.push({ x: hlX, y: hlY, w: hlW, h: hlH, number: ann.number });
      }
    }

    if (rects.length > 0) {
      const svgOverlay = buildAnnotationSVG(imgWidth, imgHeight, rects, stroke, r, g, b);
      image = sharp(rawBuffer).composite([
        { input: Buffer.from(svgOverlay), top: 0, left: 0 },
      ]);
    }
  }

  const outputPath = resolve(config.paths.screenshots, filename);
  const finalBuffer = await image.png({ compressionLevel: 2 }).toBuffer();
  writeFileSync(outputPath, finalBuffer);

  const finalMeta = await sharp(finalBuffer).metadata();
  logger.info(`Screenshot saved: ${filename} (${finalMeta.width}x${finalMeta.height})`);
  return {
    path: outputPath,
    relativePath: `screenshots/${filename}`,
    width: finalMeta.width,
    height: finalMeta.height,
  };
}
