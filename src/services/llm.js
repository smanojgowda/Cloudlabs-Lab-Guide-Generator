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
- Match the professional tone of CloudLabs published guides (reference: CloudLabsAI-Azure mslearn-fabric lab guides)

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

1. <Enhanced step instruction>

   ![](screenshots/step-XX.png)

### Task 2: <title>
...

### Summary

<Summary paragraph of what was accomplished>

HOW TO PARSE DESCRIPTIONS AND ASSIGN NUMBERS:

The user's step description contains one or more actions. Split by commas or action verbs (click, type, select, enter, expand, navigate, search, scroll, check, uncheck, toggle, pick, choose, drag, drop, hover, right-click, double-click).

- Each action mentioned = one numbered annotation **(N)** in order
- The first action = **(1)**, second = **(2)**, third = **(3)**, and so on
- Bold the UI element being acted on and place the number right after it

EXAMPLES (notice how casual input becomes professional output):

Example 1 — Description: "click on serach bar and type vm"
  → Two actions → assign (1) and (2). Fix spelling "serach"→"Search", expand "vm"→"Virtual machine":
  1. In the Azure portal, click on the **Search resources, services, and docs (1)** search bar at the top, type **Virtual machine (2)**, and select **Virtual machines** under **Services**.

     ![](screenshots/step-01.png)

Example 2 — Description: "click on Profile icon, click on Free trial"
  → Two actions → assign (1) and (2):
  1. On the **Power BI homepage**, click on the **Profile icon (1)** on the top right, and then click on **Free trial (2)**.

     ![](screenshots/step-02.png)

Example 3 — Description: "select Workspaces, click New workspace"
  → Two actions → assign (1) and (2):
  1. On the left-hand pane, select **Workspaces (1)** and click on **+ New workspace (2)**.

     ![](screenshots/step-03.png)

Example 4 — Description: "click create, click vm"
  → Two actions, expand "vm"→"Virtual machine":
  1. Click on **+ Create a resource (1)**, then select **Virtual machine (2)**.

     ![](screenshots/step-04.png)

Example 5 — Description: "enter name, expand Advanced, select License mode as Fabric, select Capacity, click Apply"
  → Five actions → use bullet list for 3+ sub-actions:
  1. On the **Create a workspace** page, enter the following details:

     - Name: Enter the workspace name **(1)**
     - Expand the **Advanced (2)** section.
     - Select **License mode** as **Fabric (3)**.
     - From the dropdown list, select the available **Capacity (4)**.
     - Click **Apply (5)** to create and open the workspace.

     ![](screenshots/step-05.png)

Example 6 — Description: "pick the sub, select rg, enter vm name, choose region"
  → Four actions, expand all abbreviations:
  1. On the **Create a virtual machine** page, configure the following settings:

     - Select the **Subscription (1)** from the dropdown.
     - Select the **Resource group (2)** from the dropdown.
     - Enter the **Virtual machine name (3)**.
     - Select the **Region (4)** from the dropdown.

     ![](screenshots/step-06.png)

Example 7 — Description: "click Activate"
  → Single action:
  1. A new prompt will appear asking you to **Activate your free trial capacity**, click on **Activate (1)**.

     ![](screenshots/step-07.png)

Example 8 — Description: "go to nsg, click add inbound rule"
  → Two actions, expand "nsg":
  1. Navigate to **Network security groups (1)**, then click on **+ Add inbound port rule (2)**.

     ![](screenshots/step-08.png)

FORMATTING RULES:
- For 1-2 actions: write a single flowing sentence with **(1)**, **(2)** inline
- For 3+ actions: use a bullet list (dashes) under a brief intro line, each bullet has its **(N)** reference
- Bold ALL UI element names: buttons, fields, menu items, tab names, links, icons
- Place annotation number **(N)** immediately after the bold element name

CRITICAL RULES:
1. Group related steps into logical tasks. If a step navigates to a new service or starts a different objective, start a new task.
2. Each recorded step = one numbered instruction in the guide. NEVER split a single step's actions into multiple numbered instructions. All actions in one description stay as ONE step.
3. Place EVERY screenshot image DIRECTLY below its step instruction, indented with 3-4 spaces.
4. Use ">" prefix for notes: > **Note:** <text>
5. Number steps sequentially within each task, restarting at 1 for each new task.
6. Do NOT add YAML frontmatter.
7. Do NOT truncate — output the FULL guide for ALL steps.
8. Use imperative tone: "Click...", "Navigate to...", "Enter...", "Select..."
9. The lab title should follow "Lab XX: <Title>" format if not already.
10. If annotations array data is available, use the target text/ariaLabel to get exact UI element names. Otherwise infer from the description and page context.
11. NEVER output the user's raw casual text. ALWAYS rewrite professionally. Treat the description as rough notes — your output is the published guide.

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
