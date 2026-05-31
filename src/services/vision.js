/**
 * Vision Service — GPT-4o Vision analysis for auto-recording
 *
 * Analyzes screenshots + DOM context to auto-generate professional step descriptions
 * and identify UI element annotation positions.
 */
import { AzureOpenAI, OpenAI } from 'openai';
import { readFileSync } from 'fs';
import config from '../config.js';
import logger from '../utils/logger.js';

let client = null;

function getClient() {
  if (client) return client;
  const { provider, azure, openai } = config.llm;

  if (provider === 'azure') {
    let baseEndpoint = azure.endpoint || '';
    try {
      const u = new URL(baseEndpoint);
      baseEndpoint = `${u.protocol}//${u.host}`;
    } catch { /* leave as-is */ }

    client = new AzureOpenAI({
      apiKey: azure.apiKey,
      endpoint: baseEndpoint,
      apiVersion: azure.apiVersion,
      deployment: azure.deployment,
    });
  } else {
    client = new OpenAI({ apiKey: openai.apiKey });
  }
  return client;
}

function getModel() {
  return config.llm.provider === 'azure'
    ? config.llm.azure.deployment
    : (config.llm.openai.model || 'gpt-4o');
}

// ─── System Prompt for Vision Analysis ────────────────────────────────

const VISION_SYSTEM = `You are an expert Azure Portal UI analyzer. You receive a screenshot of the Azure Portal along with interaction context (clicked elements, typed text, navigation events).

Your job:
1. Analyze the screenshot and interaction data
2. Generate a professional step description in CloudLabs format
3. Identify the key UI elements that were interacted with

RULES:
- Write in imperative, professional tone: "Click on...", "Navigate to...", "Enter..."
- ALWAYS expand abbreviations: vm→Virtual machine, rg→Resource group, nsg→Network security group, vnet→Virtual network, etc.
- Use the exact UI element names visible in the screenshot
- Bold important element names using **markdown**
- Assign numbered annotations **(1)**, **(2)** for each action
- Be concise but complete — one flowing sentence for 1-2 actions, bullet list for 3+ actions
- Reference the page context (title, URL) to use correct Azure service names

OUTPUT FORMAT (respond ONLY with this JSON, no markdown fences):
{
  "description": "Professional CloudLabs-format step description with **(1)**, **(2)** annotations",
  "summary": "Brief 5-10 word summary of the action for the step card",
  "uiElements": [
    {
      "name": "Human-readable element name",
      "action": "click|type|select|navigate|expand|scroll",
      "annotationNumber": 1
    }
  ],
  "confidence": 0.95,
  "isSignificantAction": true,
  "suggestedTaskGroup": "Optional: suggest a task group name if this starts a new logical section"
}

If the interaction is trivial (e.g., insignificant scroll, click on blank area, loading state), set isSignificantAction to false.`;

/**
 * Analyze a screenshot + interaction context using GPT-4o Vision.
 *
 * @param {object} opts
 * @param {Buffer|string} opts.screenshot - PNG buffer or base64 string
 * @param {Array<object>} opts.interactions - recent click/type events from CDP
 * @param {string} opts.pageUrl - current page URL
 * @param {string} opts.pageTitle - current page title
 * @param {object|null} opts.clickBox - last clicked element bounding box + metadata
 * @returns {Promise<object>} analysis result
 */
export async function analyzeStep(opts) {
  const { screenshot, interactions, pageUrl, pageTitle, clickBox } = opts;
  logger.info('Vision: Analyzing screenshot with GPT-4o...');

  const ai = getClient();

  // Convert screenshot to base64 if it's a Buffer
  const base64 = Buffer.isBuffer(screenshot)
    ? screenshot.toString('base64')
    : screenshot;

  // Build interaction context
  const contextData = {
    pageUrl: pageUrl || '',
    pageTitle: pageTitle || '',
    interactions: (interactions || []).map(i => ({
      type: i.type,
      target: i.text || i.ariaLabel || i.cssSelector || i.tag || 'unknown',
      value: i.value || '',
      timestamp: i.timestamp || '',
    })),
    clickedElement: clickBox ? {
      text: clickBox.text || '',
      ariaLabel: clickBox.ariaLabel || '',
      role: clickBox.role || '',
      tag: clickBox.tag || '',
      placeholder: clickBox.placeholder || '',
      id: clickBox.id || '',
      cssSelector: clickBox.cssSelector || '',
      parentText: clickBox.parentText || '',
      type: clickBox.type || '',
    } : null,
  };

  try {
    const response = await ai.chat.completions.create({
      model: getModel(),
      messages: [
        { role: 'system', content: VISION_SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this Azure Portal screenshot and the interaction context below. Generate a professional step description.\n\nContext:\n${JSON.stringify(contextData, null, 2)}`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
      temperature: 0.3,
      max_completion_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content?.trim();
    logger.info(`Vision: Analysis complete (${content?.length} chars)`);

    // Parse JSON response
    try {
      // Strip markdown code fences if present
      const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const result = JSON.parse(cleaned);
      return {
        description: result.description || '',
        summary: result.summary || '',
        uiElements: result.uiElements || [],
        confidence: result.confidence ?? 0.5,
        isSignificantAction: result.isSignificantAction !== false,
        suggestedTaskGroup: result.suggestedTaskGroup || '',
      };
    } catch (parseErr) {
      logger.warn(`Vision: Failed to parse JSON response, using raw text. Error: ${parseErr.message}`);
      return {
        description: content,
        summary: content.slice(0, 60),
        uiElements: [],
        confidence: 0.3,
        isSignificantAction: true,
        suggestedTaskGroup: '',
      };
    }
  } catch (err) {
    logger.error(`Vision: Analysis failed: ${err.message}`);
    throw err;
  }
}

/**
 * Batch-analyze multiple steps for a complete session.
 * Used when generating the final guide to enhance all descriptions at once.
 *
 * @param {Array<object>} steps - recorded steps with screenshot paths
 * @returns {Promise<Array<object>>} enhanced step descriptions
 */
export async function batchAnalyze(steps) {
  logger.info(`Vision: Batch analyzing ${steps.length} steps...`);
  const results = [];

  for (const step of steps) {
    try {
      let screenshotBase64;
      if (step.screenshotPath) {
        screenshotBase64 = readFileSync(step.screenshotPath).toString('base64');
      }

      if (!screenshotBase64) {
        results.push(null);
        continue;
      }

      const analysis = await analyzeStep({
        screenshot: screenshotBase64,
        interactions: step.annotations || [],
        pageUrl: step.pageUrl,
        pageTitle: step.pageTitle,
        clickBox: step.annotations?.[0]?.target || null,
      });

      results.push(analysis);
    } catch (err) {
      logger.warn(`Vision: Failed to analyze step ${step.stepNumber}: ${err.message}`);
      results.push(null);
    }
  }

  logger.info(`Vision: Batch analysis complete — ${results.filter(Boolean).length}/${steps.length} succeeded`);
  return results;
}
