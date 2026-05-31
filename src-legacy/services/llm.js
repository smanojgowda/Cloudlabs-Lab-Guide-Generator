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

const GUIDE_SYSTEM = `You are an expert technical writer producing Azure lab guides in CloudLabs format — the EXACT format used by Spektra Systems / CloudLabsAI.

You receive a list of recorded steps. Each step has a description, page URL, page title, screenshot path, and optionally annotations.

IMPORTANT — The step DESCRIPTION is your primary source of truth. The user writes descriptions in casual, shorthand language — they may contain abbreviations, spelling mistakes, short forms, slang, or incomplete phrases. YOUR JOB IS TO REWRITE EVERY DESCRIPTION INTO POLISHED, PROFESSIONAL CloudLabs-format instructions. NEVER copy the user's raw wording literally.

Your job is to:
1. Parse the description to identify each individual action (separated by commas or natural language connectors)
2. Assign **(1)**, **(2)**, **(3)** etc. to each action IN ORDER — matching the numbered highlights in the screenshot
3. REWRITE into professional, polished CloudLabs-format instructions using proper Azure terminology

PROFESSIONAL REWRITING RULES (MANDATORY):
- ALWAYS expand abbreviations and short forms to their full, proper names:
  "vm" / "VM" → "Virtual machine"
  "rg" → "Resource group"
  "nsg" → "Network security group"
  "vnet" → "Virtual network"
  "nic" → "Network interface"
  "pip" → "Public IP address"
  "lb" → "Load balancer"
  "sa" / "stor acct" → "Storage account"
  "k8s" → "Kubernetes"
  "aks" → "Azure Kubernetes Service"
  "sql db" → "SQL Database"
  "app svc" → "App Service"
  "func app" → "Function App"
  "kv" → "Key vault"
  "sub" → "Subscription"
  "mgmt" → "Management"
  "config" → "Configuration"
  "params" → "Parameters"
  "props" → "Properties"
  "auth" → "Authentication"
  "pwd" / "pass" → "Password"
  "usr" → "Username"
  "addr" → "Address"
  "env" → "Environment"
  And any other Azure/cloud abbreviation — always use the full official name
- Fix ALL spelling mistakes silently — never reproduce typos
- Replace casual phrasing with professional imperative instructions:
  "click on serach bar and type vm" → "click on the **Search resources, services, and docs (1)** search bar, type **Virtual machine (2)**"
  "go to rg" → "Navigate to **Resource groups**"
  "hit create" → "Click on **Create**"
  "pick the sub" → "Select the **Subscription**"
  "open the nsg stuff" → "Navigate to **Network security groups**"
- Use proper Azure UI element names. The page URL and page title provide context about which Azure service/page the user is on — use this to write accurate element names
- Write as if for a first-time Azure user who needs clear, unambiguous guidance
- Match the professional tone of CloudLabs published guides (reference: CloudLabsAI-Azure / Spektra Systems lab guides)

OUTPUT FORMAT (follow EXACTLY — this is the real CloudLabs format):

# Exercise N: <Lab Title>

## Estimated Duration: <X> Minutes

## Lab Overview

<2-3 paragraph overview explaining what the user will do and why>

## Lab Objectives

In this lab, you will complete the following tasks:

- Task 1: <title inferred from steps>
- Task 2: <title inferred from steps>

### Task 1: <title>

In this task, you will <1-2 sentence description of what this task accomplishes>.

1. <Step instruction with bold UI elements and numbered annotations>

   ![](screenshots/step-XX.png)

1. <Next step>

   ![](screenshots/step-XX.png)

### Task 2: <title>

In this task, you will <description>.

1. <Step instruction>

   ![](screenshots/step-XX.png)

## Review

In this exercise, you performed the following:

- <Bullet summary of Task 1>
- <Bullet summary of Task 2>

### You have successfully completed this exercise.

HOW TO PARSE DESCRIPTIONS AND ASSIGN NUMBERS:

The user's step description contains one or more actions. Split by commas or action verbs (click, type, select, enter, expand, navigate, search, scroll, check, uncheck, toggle, pick, choose, drag, drop, hover, right-click, double-click).

- Each action mentioned = one numbered annotation **(N)** in order
- The first action = **(1)**, second = **(2)**, third = **(3)**, and so on
- Bold the UI element being acted on and place the number right after it

EXAMPLES (from real CloudLabs guides — follow this style exactly):

Example 1 — Description: "search for AI Search, select AI Search"
  → Two actions:
  1. In the Azure portal, search for **AI Search (1)** and select **AI Search (2)** Resource.

     ![](screenshots/step-01.png)

Example 2 — Description: "click create on AI Search page"
  → Single action:
  1. Click on **+ Create** on the **Microsoft Foundry | AI Search** page.

     ![](screenshots/step-02.png)

Example 3 — Description: "select RG Foundry, enter name aisearch, select East US 2, pricing Basic, click Review + Create"
  → Five actions → use bullet list:
  1. Enter the following details:

     - Resource Group: Select **Foundry** **(1)**
     - Name: Enter **aisearch** **(2)**
     - Region: Select **East US 2** **(3)**
     - Pricing tier: **Basic** **(4)**
     - Click on **Review + Create** **(5)**

       ![](screenshots/step-03.png)

Example 4 — Description: "click on execute cell button, here we are loading the environment"
  → Single action with explanation:
  1. Click on the **Execute cell** button. Here, we are loading the environment with the variables from the **.env** file and initializing the client.

     ![](screenshots/step-04.png)

Example 5 — Description: "cell output shows success"
  → Output verification step:
  1. When the cell executes successfully, the output will be expected as shown below.

     ![](screenshots/step-05.png)

Example 6 — Description: "click Azure logo, search Microsoft Foundry, select Microsoft Foundry"
  → Three actions, navigation:
  1. Navigate back to the Azure portal home page by clicking the **Microsoft Azure logo (1)** or the **Home** button at the top-left. Then search for **Microsoft Foundry (2)** and select **Microsoft Foundry (3)**.

     ![](screenshots/step-06.png)

Example 7 — Description: "expand Use with Foundry, select AI Hubs, open Create dropdown, select Hub"
  → Four actions from left nav:
  1. From the left navigation pane, expand **Use with Foundry (1)**, select **AI Hubs (2)**, open the **+ Create (3)** dropdown, and select **Hub (4)**.

     ![](screenshots/step-07.png)

Example 8 — Description: "enter name, expand Advanced, select License mode as Fabric, select Capacity, click Apply"
  → Five actions → use bullet list:
  1. On the **Create a workspace** page, enter the following details:

     - Name: Enter the workspace name **(1)**
     - Expand the **Advanced (2)** section.
     - Select **License mode** as **Fabric (3)**.
     - From the dropdown list, select the available **Capacity (4)**.
     - Click **Apply (5)** to create and open the workspace.

     ![](screenshots/step-08.png)

Example 9 — Description: "save file"
  → Standard save step (use this exact pattern):
  1. Click on **Ctrl+S** or click **File** **(1)** from the top menu and select **Save All** **(2)** to save all changes.

     ![](screenshots/save_g_1.png)

FORMATTING RULES:
- For 1-2 actions: write a single flowing sentence with **(1)**, **(2)** inline
- For 3+ actions: use a bullet list (dashes) under a brief intro line, each bullet has its **(N)** reference
- Bold ALL UI element names: buttons, fields, menu items, tab names, links, icons
- Place annotation number **(N)** immediately after the bold element name
- ALL steps use "1." numbering (Markdown auto-numbers them)
- Notes use: > **Note:** <text> with screenshot below if relevant

CRITICAL RULES:
1. Group related steps into logical tasks. If a step navigates to a new service or starts a different objective, start a new task.
2. Each recorded step = one numbered instruction in the guide. NEVER split a single step's actions into multiple numbered instructions. All actions in one description stay as ONE step.
3. Place EVERY screenshot image DIRECTLY below its step instruction, indented with 3-4 spaces.
4. Use ">" prefix for notes: > **Note:** <text>
5. Number ALL steps with "1." — Markdown will auto-number them. This is the CloudLabs standard.
6. Do NOT add YAML frontmatter.
7. Do NOT truncate — output the FULL guide for ALL steps.
8. Use imperative tone: "Click on...", "Navigate to...", "Enter...", "Select...", "From the left navigation pane..."
9. Start each task with: "In this task, you will <description>."
10. If annotations array data is available, use the target text/ariaLabel to get exact UI element names. Otherwise infer from the description and page context.
11. NEVER output the user's raw casual text. ALWAYS rewrite professionally. Treat the description as rough notes — your output is the published guide.
12. End with a Review section summarizing what was accomplished, then "### You have successfully completed this exercise."
13. For output/result verification steps, use: "When the cell executes successfully, the output will be expected as shown below." or "Once the deployment is complete, click on **Go to resource**."

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

// ─── Chat-based Guide Editing ─────────────────────────────────────────

const EDIT_SYSTEM = `You are an expert lab-guide editor. The user will give you a Markdown lab guide and an instruction describing what to change.

Your job:
1. Identify the EXACT portion of the existing guide that should be changed.
2. Produce the replacement text.
3. Return ONLY valid JSON (no markdown fences, no extra text) in this format:

{
  "explanation": "Brief description of what you changed and why",
  "changes": [
    {
      "oldText": "the exact text from the guide to replace (copy verbatim, including whitespace and newlines)",
      "newText": "the replacement text"
    }
  ]
}

RULES:
- "oldText" must be a verbatim substring of the original markdown. Copy it exactly — including line breaks, spaces, and formatting.
- Keep changes minimal and focused. Only change what the user asked for.
- If multiple separate edits are needed, return multiple items in the "changes" array.
- If the user's request is unclear or cannot be done, return: { "explanation": "reason", "changes": [] }
- Do NOT output anything outside the JSON object.`;

/**
 * Ask LLM to propose edits to an existing guide based on a user instruction.
 *
 * @param {string} markdown - current guide markdown
 * @param {string} userMessage - what the user wants changed
 * @returns {Promise<{explanation: string, changes: Array<{oldText: string, newText: string}>}>}
 */
export async function proposeGuideEdit(markdown, userMessage) {
  logger.info('LLM: Proposing guide edit…');
  const ai = getClient();

  const response = await ai.chat.completions.create({
    model: getModel(),
    messages: [
      { role: 'system', content: EDIT_SYSTEM },
      {
        role: 'user',
        content: `Here is the current guide:\n\n---\n${markdown}\n---\n\nUser request: ${userMessage}`,
      },
    ],
    temperature: 1,
    max_completion_tokens: 4096,
  });

  const raw = response.choices[0]?.message?.content?.trim();
  logger.info(`LLM: Edit proposal received (${raw?.length} chars)`);

  try {
    const parsed = JSON.parse(raw);
    return {
      explanation: parsed.explanation || '',
      changes: Array.isArray(parsed.changes) ? parsed.changes : [],
    };
  } catch {
    logger.warn('LLM: Could not parse edit response as JSON');
    return { explanation: raw || 'Sorry, I could not process that request.', changes: [] };
  }
}

// ─── Guide-Making Assist ──────────────────────────────────────────────

const ASSIST_SYSTEM = `You are an Azure lab-guide planning assistant for Spektra Systems / CloudLabsAI.

The user gives you a TOPIC or TITLE of an Azure lab exercise. Generate a concise step-by-step procedure a guide developer can follow in the Azure Portal.

RULES:
- Keep it concise: 2-4 tasks, each with 3-8 steps
- Group related steps into numbered TASKS
- Steps must be specific (e.g., "Click **+ Create a resource**")
- Use proper Azure UI element names and navigation paths
- Use sensible defaults for regions, SKUs, names
- Output as JSON

RESPOND WITH VALID JSON ONLY (no markdown wrapping, no \`\`\`json blocks):

{
  "labTitle": "Full professional title",
  "estimatedDuration": "X minutes",
  "overview": "2-3 sentence overview of what the lab covers and why",
  "prerequisites": ["List of prerequisites or pre-created resources"],
  "tasks": [
    {
      "taskNumber": 1,
      "title": "Task title",
      "description": "What this task accomplishes",
      "steps": [
        {
          "stepNumber": 1,
          "instruction": "Exact instruction with **bold UI elements**",
          "tip": "Optional helpful tip or expected behavior"
        }
      ]
    }
  ]
}`;

/**
 * Generate a step-by-step procedure outline for a lab topic.
 * Helps guide developers who know the topic but not the exact steps.
 *
 * @param {string} topic - Lab topic, title, or description
 * @param {string} [additionalContext] - Optional extra context (e.g., "use East US region", "standard tier")
 * @returns {Promise<object>} - Structured procedure outline
 */
export async function generateGuideAssist(topic, additionalContext) {
  logger.info(`LLM: Generating guide assist for topic: "${topic}"`);
  const ai = getClient();

  let userPrompt = `Generate a detailed step-by-step Azure lab procedure for:\n\nTopic: ${topic}`;
  if (additionalContext) {
    userPrompt += `\n\nAdditional context: ${additionalContext}`;
  }

  const response = await ai.chat.completions.create({
    model: getModel(),
    messages: [
      { role: 'system', content: ASSIST_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
    temperature: 1,
    max_completion_tokens: 2048,
  });

  const raw = response.choices[0]?.message?.content?.trim();
  logger.info(`LLM: Guide assist received (${raw?.length} chars)`);

  try {
    // Strip markdown code fences if the model wraps them
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(cleaned);
    return parsed;
  } catch {
    logger.warn('LLM: Could not parse assist response as JSON, returning raw');
    return {
      labTitle: topic,
      estimatedDuration: 'Unknown',
      overview: raw || 'Could not generate procedure.',
      prerequisites: [],
      tasks: [],
    };
  }
}
