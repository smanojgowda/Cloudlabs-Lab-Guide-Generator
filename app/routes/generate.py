"""
API routes for lab guide generation — Azure OpenAI edition.
"""

import os
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.services.extractors import (
    extract_text_from_docx,
    extract_text_from_pdf,
    prepare_image_for_api,
    read_markdown_file,
)
from app.services.lab_generator import LabGuideGenerator

router = APIRouter(prefix="/api", tags=["Lab Guide Generation"])


def get_generator() -> LabGuideGenerator:
    missing = []
    if not os.getenv("AZURE_OPENAI_API_KEY"):
        missing.append("AZURE_OPENAI_API_KEY")
    if not os.getenv("AZURE_OPENAI_ENDPOINT"):
        missing.append("AZURE_OPENAI_ENDPOINT")
    if missing:
        raise HTTPException(
            status_code=500,
            detail=f"Missing environment variables: {', '.join(missing)}. Please check your .env file.",
        )
    return LabGuideGenerator()


@router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "provider": "Azure OpenAI",
        "deployment": os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-5.1-codex-mini"),
        "endpoint_configured": bool(os.getenv("AZURE_OPENAI_ENDPOINT")),
        "api_key_configured": bool(os.getenv("AZURE_OPENAI_API_KEY")),
    }


@router.post("/generate/prompt")
async def generate_from_prompt(
    prompt: str = Form(...),
    template: Optional[str] = Form(None),
    extra_instructions: Optional[str] = Form(None),
):
    """Generate a lab guide from a text description."""
    generator = get_generator()
    try:
        result = generator.generate_from_text(
            content=prompt,
            input_type="prompt",
            template=template or None,
            extra_instructions=extra_instructions or None,
        )
        return JSONResponse({"markdown": result, "input_type": "prompt"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate/document")
async def generate_from_document(
    file: UploadFile = File(...),
    template: Optional[str] = Form(None),
    extra_instructions: Optional[str] = Form(None),
    images: Optional[List[UploadFile]] = File(None),
):
    """Generate a lab guide from a PDF or Word document."""
    generator = get_generator()
    file_bytes = await file.read()
    filename = file.filename.lower()

    if filename.endswith(".pdf"):
        text_content = extract_text_from_pdf(file_bytes)
        input_type = "document"
    elif filename.endswith(".docx") or filename.endswith(".doc"):
        text_content = extract_text_from_docx(file_bytes)
        input_type = "document"
    elif filename.endswith(".md") or filename.endswith(".txt"):
        text_content = read_markdown_file(file_bytes)
        input_type = "template"
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type. Use PDF, DOCX, MD, or TXT.")

    try:
        if images:
            image_data_list = [
                prepare_image_for_api(await f.read(), f.filename) for f in images
            ]
            result = generator.generate_from_mixed(
                text_content=text_content,
                image_data_list=image_data_list,
                input_type=input_type,
                template=template or None,
                extra_instructions=extra_instructions or None,
            )
        else:
            result = generator.generate_from_text(
                content=text_content,
                input_type=input_type,
                template=template or None,
                extra_instructions=extra_instructions or None,
            )
        return JSONResponse({"markdown": result, "input_type": input_type})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate/images")
async def generate_from_images(
    files: List[UploadFile] = File(...),
    template: Optional[str] = Form(None),
    extra_instructions: Optional[str] = Form(None),
):
    """Generate a lab guide from screenshots using GPT vision."""
    if not files:
        raise HTTPException(status_code=400, detail="At least one image is required.")
    generator = get_generator()
    try:
        image_data_list = [
            prepare_image_for_api(await f.read(), f.filename) for f in files
        ]
        result = generator.generate_from_images(
            image_data_list=image_data_list,
            template=template or None,
            extra_instructions=extra_instructions or None,
        )
        return JSONResponse({"markdown": result, "input_type": "images"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate/template")
async def generate_from_template(
    file: UploadFile = File(...),
    extra_instructions: Optional[str] = Form(None),
):
    """Expand an existing Markdown template into a full lab guide."""
    generator = get_generator()
    file_bytes = await file.read()
    content = read_markdown_file(file_bytes)
    try:
        result = generator.generate_from_text(
            content=content,
            input_type="template",
            extra_instructions=extra_instructions or None,
        )
        return JSONResponse({"markdown": result, "input_type": "template"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
