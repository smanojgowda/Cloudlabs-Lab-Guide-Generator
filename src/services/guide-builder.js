/**
 * Guide Builder — assemble the final CloudLabs-format Markdown lab guide
 * Record Mode: takes recorded steps (not a plan) and generates the guide.
 */
import { writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { resolve } from 'path';
import config from '../config.js';
import logger from '../utils/logger.js';
import { generateGuide } from './llm.js';

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

  // Write the guide
  const mdPath = resolve(guideDir, 'guide.md');
  writeFileSync(mdPath, markdown, 'utf-8');
  logger.info(`Lab guide written to ${mdPath}`);

  // Write JSON manifest
  const manifest = {
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
      annotations: s.annotations || [],
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
