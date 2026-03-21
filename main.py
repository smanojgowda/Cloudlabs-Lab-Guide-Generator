"""
AI-Powered Lab Guide Generator — Azure OpenAI Edition
FastAPI entry point
"""
import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from app.routes.generate import router as generate_router

load_dotenv()

app = FastAPI(
    title="AI Lab Guide Generator (Azure OpenAI)",
    description="Generate structured Markdown lab guides using Azure OpenAI gpt-5.1-codex-mini.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

static_dir = Path(__file__).parent / "app" / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
app.include_router(generate_router)

@app.get("/", include_in_schema=False)
async def serve_frontend():
    return FileResponse(str(static_dir / "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
