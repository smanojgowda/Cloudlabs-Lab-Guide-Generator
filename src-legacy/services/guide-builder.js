/**
 * Guide Builder — assemble the final CloudLabs-format Markdown lab guide
 * Record Mode: takes recorded steps (not a plan) and generates the guide.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import config from '../config.js';
import logger from '../utils/logger.js';
import { generateGuide } from './llm.js';

/**
 * Version the current guide.md before overwriting it.
 * Saves to `versions/guide.v1.md`, `guide.v2.md`, etc.
 * Returns the version number created, or 0 if no previous guide existed.
 */
export function versionGuide(guideDir) {
  const guidePath = resolve(guideDir, 'guide.md');
  if (!existsSync(guidePath)) return 0;

  const versionsDir = resolve(guideDir, 'versions');
  if (!existsSync(versionsDir)) mkdirSync(versionsDir, { recursive: true });

  // Find next version number
  const existing = readdirSync(versionsDir).filter(f => /^guide\.v\d+\.md$/.test(f));
  const nums = existing.map(f => parseInt(f.match(/\.v(\d+)\./)[1], 10));
  const nextVersion = nums.length > 0 ? Math.max(...nums) + 1 : 1;

  const currentContent = readFileSync(guidePath, 'utf-8');
  const versionPath = resolve(versionsDir, `guide.v${nextVersion}.md`);
  writeFileSync(versionPath, currentContent, 'utf-8');
  logger.info(`Guide versioned: v${nextVersion} saved to ${versionPath}`);
  return nextVersion;
}

/**
 * List all versions of a guide in a directory.
 * Returns array of { version, filename, path } sorted by version number.
 */
export function listGuideVersions(guideDir) {
  const versionsDir = resolve(guideDir, 'versions');
  if (!existsSync(versionsDir)) return [];

  return readdirSync(versionsDir)
    .filter(f => /^guide\.v\d+\.md$/.test(f))
    .map(f => {
      const version = parseInt(f.match(/\.v(\d+)\./)[1], 10);
      return { version, filename: f, path: resolve(versionsDir, f) };
    })
    .sort((a, b) => a.version - b.version);
}

/**
 * Restore a specific version as the current guide.md.
 * Versions the current guide first before restoring.
 */
export function restoreGuideVersion(guideDir, version) {
  const versionPath = resolve(guideDir, 'versions', `guide.v${version}.md`);
  if (!existsSync(versionPath)) throw new Error(`Version ${version} not found`);

  // Save current as a new version before restoring
  versionGuide(guideDir);

  const content = readFileSync(versionPath, 'utf-8');
  const guidePath = resolve(guideDir, 'guide.md');
  writeFileSync(guidePath, content, 'utf-8');
  logger.info(`Guide restored from v${version}`);
  return content;
}

/**
 * Build the final lab guide from recorded steps.
 *
 * @param {Array<object>} recordedSteps - steps from the recorder
 * @param {string} labTitle - lab title
 * @param {string} labDescription - lab description
 * @param {string} [guideName] - output folder name
 * @returns {Promise<{markdownPath: string, markdown: string, guideDir: string}>}
 */
export async function buildGuide(recordedSteps, labTitle, labDescription, guideName) {
  const name = guideName || sanitizeFilename(labTitle || 'lab-guide');
  const guideDir = resolve(config.paths.output, name);
  const guideScreenshotsDir = resolve(guideDir, 'screenshots');

  if (!existsSync(guideDir)) mkdirSync(guideDir, { recursive: true });
  if (!existsSync(guideScreenshotsDir)) mkdirSync(guideScreenshotsDir, { recursive: true });

  // Copy screenshots into the guide directory
  for (const step of recordedSteps) {
    if (step.screenshotPath && existsSync(step.screenshotPath)) {
      try {
        copyFileSync(step.screenshotPath, resolve(guideScreenshotsDir, step.screenshotFilename));
      } catch { /* ignore copy errors */ }
    }
  }

  // Generate Markdown via LLM
  let markdown;
  try {
    markdown = await generateGuide(labTitle, labDescription, recordedSteps);
  } catch (err) {
    logger.warn(`LLM guide generation failed: ${err.message}. Using template fallback.`);
    markdown = buildFallbackMarkdown(labTitle, labDescription, recordedSteps);
  }

  // Version the existing guide before overwriting
  versionGuide(guideDir);

  // Write the guide
  const mdPath = resolve(guideDir, 'guide.md');
  writeFileSync(mdPath, markdown, 'utf-8');
  logger.info(`Lab guide written to ${mdPath}`);

  // Write JSON manifest
  const manifest = {
    schemaVersion: 2,
    labTitle,
    labDescription,
    generatedAt: new Date().toISOString(),
    stepsCount: recordedSteps.length,
    steps: recordedSteps.map(s => ({
      stepNumber: s.stepNumber,
      description: s.description,
      screenshot: s.screenshotFilename,
      pageUrl: s.pageUrl,
      pageTitle: s.pageTitle,
      annotations: (s.annotations || []).map(ann => ({
        ...ann,
        pageUrl: ann.pageUrl || s.pageUrl || '',
      })),
    })),
  };
  writeFileSync(resolve(guideDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  return { markdownPath: mdPath, markdown, guideDir };
}

/**
 * CloudLabs-format fallback Markdown template when LLM is unavailable
 */
function buildFallbackMarkdown(labTitle, labDescription, recordedSteps) {
  const lines = [];

  lines.push(`# ${labTitle || 'Lab Guide'}`);
  lines.push('');
  lines.push('## Lab overview');
  lines.push('');
  lines.push(labDescription || 'This lab guides you through Azure Portal tasks.');
  lines.push('');

  lines.push('## Lab objectives');
  lines.push('');
  lines.push('By the end of this lab, you will be able to complete the following tasks.');
  lines.push('');

  // All steps as a single task in fallback mode
  lines.push('### Task 1: Complete Lab Steps');
  lines.push('');

  for (const step of recordedSteps) {
    lines.push(`${step.stepNumber}. ${step.description}`);
    lines.push('');
    if (step.screenshotFilename) {
      lines.push(`   ![](screenshots/${step.screenshotFilename})`);
      lines.push('');
    }
  }

  lines.push('### Summary');
  lines.push('');
  lines.push('You have successfully completed all the tasks in this lab.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Sanitize a string into a valid directory/file name
 */
function sanitizeFilename(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
