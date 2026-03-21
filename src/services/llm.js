/**
 * LLM Service — Azure OpenAI / OpenAI wrapper
 *
 * Record Mode: generates CloudLabs-format lab guides from recorded steps + screenshots.
 */
import { AzureOpenAI, OpenAI } from 'openai';
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

    logger.info(`AzureOpenAI: endpoint=${baseEndpoint}, deployment=${azure.deployment}, apiVersion=${azure.apiVersion}`);
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
    : config.llm.openai.model;
}

// ─── System Prompt ────────────────────────────────────────────────────

const GUIDE_SYSTEM = `You are an expert technical writer producing Azure lab guides in CloudLabs format.

You receive a list of recorded steps (each with a description, page URL, page title, and a screenshot path). You also receive the lab title and description. Your job is to organize these steps into logical tasks, enhance the step descriptions into clear CloudLabs-format instructions, and produce a complete Markdown lab guide.

OUTPUT FORMAT (follow EXACTLY):

# <Lab Title>

## Lab overview

<2-3 paragraph overview based on the lab description and steps>

## Lab objectives

By the end of this lab, you will be able to:

- Task 1: <title inferred from steps>
- Task 2: <title inferred from steps>

### Task 1: <title>

<1-2 sentence task description>

1. <Enhanced step instruction with bold **(N)** references to annotated UI elements in the screenshot>

   ![](screenshots/step-XX.png)

2. <Next step instruction>

   ![](screenshots/step-XX.png)

> **Note:** <any relevant notes or tips>

### Task 2: <title>
...

### Summary

<Summary paragraph of what was accomplished>

CRITICAL RULES:
1. Group related steps into logical tasks. If a step navigates to a new service or starts a different objective, start a new task.
2. For each step, rewrite the user's description into a clear, imperative instruction. If the description mentions clicking a button or entering text, use bold for the UI element name and add **(N)** numbered references where the screenshot has numbered annotations.
3. Place EVERY screenshot image DIRECTLY below its corresponding step instruction, indented with 3 spaces.
4. Use ">" prefix for notes: > **Note:** <text>
5. Number steps sequentially within each task, restarting at 1 for each new task.
6. Bold important field names, button names, and menu items.
7. Do NOT add YAML frontmatter.
8. Do NOT truncate — output the FULL guide for ALL steps.
9. Use imperative tone: "Click...", "Navigate to...", "Enter...", "Select..."
10. If a step has annotations (numbered highlights), reference them with **(1)**, **(2)** etc. in the instruction text.
11. The lab title should follow "Lab XX: <Title>" format if not already.

Output ONLY valid Markdown.`;

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Generate CloudLabs-format Markdown lab guide from recorded steps.
 *
 * @param {string} labTitle - lab title
 * @param {string} labDescription - what the lab is about
 * @param {Array<object>} recordedSteps - steps from the recorder
 * @returns {Promise<string>} - Markdown content
 */
export async function generateGuide(labTitle, labDescription, recordedSteps) {
  logger.info('LLM: Generating lab guide from recorded steps…');
  const ai = getClient();

  const stepsData = recordedSteps.map(s => ({
    stepNumber: s.stepNumber,
    description: s.description,
    screenshotFile: s.screenshotFilename,
    pageUrl: s.pageUrl,
    pageTitle: s.pageTitle,
    annotations: s.annotations || [],
  }));

  const inputData = {
    labTitle,
    labDescription,
    totalSteps: recordedSteps.length,
    steps: stepsData,
  };

  const response = await ai.chat.completions.create({
    model: getModel(),
    messages: [
      { role: 'system', content: GUIDE_SYSTEM },
      {
        role: 'user',
        content: `Generate the complete Markdown lab guide from these recorded steps:\n\n${JSON.stringify(inputData, null, 2)}`,
      },
    ],
    temperature: 1,
    max_completion_tokens: 16384,
  });

  const guide = response.choices[0]?.message?.content?.trim();
  logger.info(`LLM: Guide generated (${guide?.length} chars)`);
  return guide;
}
