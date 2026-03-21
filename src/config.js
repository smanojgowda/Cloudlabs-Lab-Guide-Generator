/**
 * Configuration — single source of truth for all settings
 */
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const outputDir = resolve(process.env.OUTPUT_DIR || './output');
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

const screenshotsDir = resolve(outputDir, 'screenshots');
if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

export default {
  root: ROOT,

  // LLM
  llm: {
    provider: process.env.OPENAI_PROVIDER || 'azure',
    azure: {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
    },
  },

  // Browser / Playwright
  browser: {
    headless: process.env.HEADLESS === 'true',
    slowMo: parseInt(process.env.SLOW_MO || '100', 10),
    viewport: {
      width: parseInt(process.env.VIEWPORT_WIDTH || '1920', 10),
      height: parseInt(process.env.VIEWPORT_HEIGHT || '1080', 10),
    },
    authFile: resolve(ROOT, 'auth.json'),
    defaultTimeout: 30_000,
    navigationTimeout: 60_000,
  },

  // Paths
  paths: {
    output: outputDir,
    screenshots: screenshotsDir,
  },

  // Server
  server: {
    port: parseInt(process.env.PORT || '8000', 10),
  },

  // Screenshot processing
  screenshot: {
    quality: parseInt(process.env.SCREENSHOT_QUALITY || '90', 10),
    highlightColor: { r: 255, g: 0, b: 0, alpha: 1 },
    highlightStroke: 4,
    highlightPadding: 6,
  },
};
