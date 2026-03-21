"""
Core service for generating lab guides using Azure OpenAI (gpt-5.1-codex-mini).
Handles all input types: text prompts, documents, images, and templates.
"""

import base64
import os
from typing import Optional

import httpx


DEFAULT_TEMPLATE = """---
title: {Lab Title}
difficulty: Intermediate
duration: 60 minutes
author: {Author}
---

# Objective
Describe the end goal of this lab in one clear paragraph.

# Prerequisites
- List prerequisite 1
- List prerequisite 2

# Steps
1. **Step 1:** Prepare the environment and confirm the baseline state.
   ```bash
   # Replace with the first command or setup action
   ```
2. **Step 2:** Execute the core configuration or deployment command.
   ```azurecli
   # Replace with the second command or configuration snippet
   ```
3. **Step 3:** Validate the result or capture a screenshot reference (optional).
   ![Overview](../assets/step-3-overview.png)

# Validation
- Verify that the expected resource or output exists.
- Document how a reader can confirm the lab succeeded (logs, portal views, CLI checks).
"""

ALLOWED_CODE_LANGUAGES = ["bash", "powershell", "azurecli", "json", "python", "C#"]

VALIDATION_SPEC = """# The biggest reliability improvement will come from YAML validation, not prompting the AI.

# LLMs follow structure 70–80% of the time, but validation makes it close to deterministic.

lab_metadata:
  required: true
  fields:
    title: true
    difficulty: true
    duration: true
    author: false

sections:
  required_order:
    - Objective
    - Prerequisites
    - Steps
    - Validation

steps:
  numbering: true
  minimum_steps: 1
  screenshot_required: false

code_blocks:
  enabled: true
  allowed_languages:
    - bash
    - powershell
    - azurecli
    - json
    - python
    - C#

images:
  allowed: true
  path: "../assets/"
  format: png

validation_rules:
  require_code_block_for_cli_steps: true
  require_descriptive_step_titles: true
"""

SYSTEM_PROMPT = f"""You are an expert technical writer specializing in creating cloud and software lab guides.
Your task is to generate a well-structured, clear, and professional lab guide in Markdown format.

Follow these strict rules:
1. Always output ONLY valid Markdown — no extra commentary, no preamble, no explanation outside the document.
2. Use the provided template structure if one is given; otherwise use the default structure, but always satisfy the metadata and section order requirements described below.
3. Include realistic, runnable code blocks with correct syntax highlighting tags and keep them restricted to the allowed languages.
4. Write steps in an imperative, instructional tone ("Click...", "Run...", "Navigate to...").
5. Ensure Prerequisites and Objectives sections are always present.
6. Make instructions beginner-friendly but technically accurate.
7. Add inline notes or warnings using Markdown blockquotes (> ⚠️ Note: ...) where appropriate.
8. Each numbered Step must include a descriptive title (e.g., **Step 1:** Activate the environment) and its own paragraph of instruction.
9. The final document must be complete and not truncated.

Validation spec (must obey exactly):
{VALIDATION_SPEC}

Additional requirements derived from the spec:
- Always begin the guide with YAML front matter that includes `title`, `difficulty`, `duration`, and `author` (author may be empty but the key must exist).
- Keep sections in this exact order: Objective, Prerequisites, Steps, Validation; include each section even if it is brief.
- Number the steps (1., 2., ...) and maintain descriptive titles. CLI actions require an accompanying code block using one of {", ".join(ALLOWED_CODE_LANGUAGES)}.
- Reference images only if they are PNGs stored under ../assets/ and briefly explain what the reader is seeing.
- The Steps section must contain at least one numbered item; screenshot references are optional.
"""

def build_prompt(
    input_type: str,
    content: str,
    template: Optional[str] = None,
    extra_instructions: Optional[str] = None,
) -> str:
    """Build the user prompt based on input type."""

    template_section = f"""
Use the following Markdown template as the structural skeleton for the lab guide:

<template>
{template}
</template>
""" if template else f"""
Use this default structure for the lab guide:

<template>
{DEFAULT_TEMPLATE}
</template>
"""

    instructions_section = (
        f"\nAdditional instructions:\n{extra_instructions}\n"
        if extra_instructions else ""
    )

    prompts = {
        "prompt": f"""Generate a complete lab guide based on the following description:

<description>
{content}
</description>
{template_section}{instructions_section}
Now generate the complete Markdown lab guide:""",

        "document": f"""The following text was extracted from an uploaded document (PDF or Word).
Convert it into a well-structured lab guide:

<document_content>
{content}
</document_content>
{template_section}{instructions_section}
Now generate the complete Markdown lab guide:""",

        "image": f"""The user has uploaded screenshots showing steps performed in a system or portal.
Analyze the visual content and reconstruct the sequence of steps as a complete lab guide.
{template_section}{instructions_section}
Now generate the complete Markdown lab guide based on the screenshots:""",

        "template": f"""The user has provided an existing Markdown lab guide or partial template.
Expand and complete it into a full, polished lab guide.

<existing_content>
{content}
</existing_content>
{instructions_section}
Now generate the complete, expanded Markdown lab guide:""",
    }

    return prompts.get(input_type, prompts["prompt"])


class LabGuideGenerator:
    def __init__(self):
        self.deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-5.1-codex-mini")
        raw_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "")
        self.api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2025-04-01-preview")
        api_base = raw_endpoint
        if "/openai/" in raw_endpoint:
            api_base = raw_endpoint.split("/openai/")[0]
        self.api_base = api_base.rstrip("/")
        self.api_key = os.getenv("AZURE_OPENAI_API_KEY")

    def _chat(self, messages):
        url = f"{self.api_base}/openai/responses"
        params = {"api-version": self.api_version}
        payload = {
            "model": self.deployment,
            "input": messages,
            "max_output_tokens": 4096,
        }
        headers = {
            "api-key": self.api_key,
            "Content-Type": "application/json",
        }
        response = httpx.post(url, params=params, headers=headers, json=payload, timeout=60)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            error_body = exc.response.text
            raise RuntimeError(
                f"Azure Responses API error {exc.response.status_code}: {error_body}"
            ) from exc
        return self._extract_response_text(response.json())

    def _extract_response_text(self, response: dict) -> str:
        outputs = response.get("output", []) or []
        fragments = []
        for output in outputs:
            for content in output.get("content", []):
                if content.get("type") == "output_text":
                    text = content.get("text")
                    if text:
                        fragments.append(text)
        if not fragments and hasattr(response, "output_text") and response.output_text:
            fragments.append(response.output_text)
        return "\n".join(fragments).strip()

    def generate_from_text(
        self,
        content: str,
        input_type: str = "prompt",
        template: Optional[str] = None,
        extra_instructions: Optional[str] = None,
    ) -> str:
        """Generate a lab guide from text content."""
        user_prompt = build_prompt(input_type, content, template, extra_instructions)
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]
        return self._chat(messages)

    def generate_from_images(
        self,
        image_data_list: list,
        template: Optional[str] = None,
        extra_instructions: Optional[str] = None,
    ) -> str:
        """Generate a lab guide from screenshots using GPT vision."""
        user_prompt = build_prompt("image", "", template, extra_instructions)

        # Build multimodal content
        content_parts = []
        for i, img in enumerate(image_data_list):
            content_parts.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{img['media_type']};base64,{img['base64']}",
                    "detail": "high",
                },
            })
            content_parts.append({
                "type": "text",
                "text": f"Screenshot {i + 1} shown above.",
            })

        content_parts.append({"type": "text", "text": user_prompt})

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": content_parts},
        ]
        return self._chat(messages)

    def generate_from_mixed(
        self,
        text_content: str,
        image_data_list: list,
        input_type: str = "document",
        template: Optional[str] = None,
        extra_instructions: Optional[str] = None,
    ) -> str:
        """Generate from a combination of text + images."""
        user_prompt = build_prompt(input_type, text_content, template, extra_instructions)

        content_parts = []
        for i, img in enumerate(image_data_list):
            content_parts.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{img['media_type']};base64,{img['base64']}",
                    "detail": "high",
                },
            })
            content_parts.append({
                "type": "text",
                "text": f"Screenshot {i + 1} shown above.",
            })

        content_parts.append({"type": "text", "text": user_prompt})

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": content_parts},
        ]
        return self._chat(messages)
