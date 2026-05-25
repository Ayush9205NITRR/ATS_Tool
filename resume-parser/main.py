"""
Robust Resume Parser API
- Handles PDF, DOCX from URLs (Google Drive, Dropbox, direct links)
- Multiple extraction strategies with fallbacks
- Never crashes on bad input — always returns best-effort result
"""
import os
import re
import io
import tempfile
import traceback
from typing import Optional
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from extractors.text_extractor import extract_text_from_bytes, detect_file_type
from extractors.field_extractor import extract_all_fields
from utils.url_resolver import resolve_download_url

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[Parser] Resume Parser API ready.")
    yield
    print("[Parser] Shutting down.")

app = FastAPI(title="Resume Parser API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ParseRequest(BaseModel):
    url: str

class ParsedResume(BaseModel):
    full_name: str = ""
    email: str = ""
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    current_company: Optional[str] = None
    current_designation: Optional[str] = None
    raw_text: Optional[str] = None
    confidence: float = 0.0
    warnings: list[str] = []

class ParseResponse(BaseModel):
    success: bool
    data: ParsedResume
    error: Optional[str] = None


DOWNLOAD_TIMEOUT = 30
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB


@app.post("/parse", response_model=ParseResponse)
async def parse_resume(req: ParseRequest):
    """Parse a resume from a URL and extract candidate information."""
    warnings: list[str] = []

    if not req.url or not req.url.strip():
        return ParseResponse(
            success=False,
            data=ParsedResume(),
            error="No URL provided"
        )

    url = req.url.strip()

    # Step 1: Resolve the actual download URL
    try:
        download_url = resolve_download_url(url)
    except Exception as e:
        return ParseResponse(
            success=False,
            data=ParsedResume(warnings=[f"URL resolution failed: {str(e)}"]),
            error=f"Cannot resolve URL: {str(e)}"
        )

    # Step 2: Download the file
    try:
        file_bytes = await download_file(download_url)
    except Exception as e:
        return ParseResponse(
            success=False,
            data=ParsedResume(warnings=[f"Download failed: {str(e)}"]),
            error=f"Failed to download file: {str(e)}"
        )

    if not file_bytes:
        return ParseResponse(
            success=False,
            data=ParsedResume(warnings=["Empty file downloaded"]),
            error="Downloaded file is empty"
        )

    if len(file_bytes) > MAX_FILE_SIZE:
        return ParseResponse(
            success=False,
            data=ParsedResume(warnings=["File too large"]),
            error=f"File exceeds {MAX_FILE_SIZE // (1024*1024)}MB limit"
        )

    # Step 3: Detect file type and extract text
    file_type = detect_file_type(file_bytes)
    if file_type == "unknown":
        warnings.append("Could not detect file type, attempting all parsers")

    try:
        text = extract_text_from_bytes(file_bytes, file_type)
    except Exception as e:
        warnings.append(f"Text extraction error: {str(e)}")
        text = ""

    if not text or len(text.strip()) < 20:
        warnings.append("Very little text extracted — resume may be image-based/scanned")
        # Return partial result instead of failing
        return ParseResponse(
            success=False,
            data=ParsedResume(
                warnings=warnings,
                raw_text=text[:500] if text else None
            ),
            error="Could not extract meaningful text. Resume may be image-based or password-protected."
        )

    # Step 4: Extract structured fields from text
    try:
        fields = extract_all_fields(text)
    except Exception as e:
        warnings.append(f"Field extraction error: {str(e)}")
        fields = {}

    # Step 5: Build response
    confidence = calculate_confidence(fields)

    result = ParsedResume(
        full_name=fields.get("full_name", ""),
        email=fields.get("email", ""),
        phone=fields.get("phone", None),
        linkedin_url=fields.get("linkedin_url", None),
        current_company=fields.get("current_company", None),
        current_designation=fields.get("current_designation", None),
        raw_text=text[:2000] if text else None,
        confidence=confidence,
        warnings=warnings,
    )

    return ParseResponse(success=True, data=result)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


async def download_file(url: str) -> bytes:
    """Download file from URL with retries and proper headers."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
    }

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(DOWNLOAD_TIMEOUT),
        verify=False,  # Some resume hosts have cert issues
    ) as client:
        # Try up to 2 times
        last_error = None
        for attempt in range(2):
            try:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return resp.content
                elif resp.status_code in (403, 401):
                    raise Exception(
                        "Access denied. The file may be private — ensure the link has public/view access."
                    )
                elif resp.status_code == 404:
                    raise Exception("File not found (404). The link may be broken or expired.")
                else:
                    last_error = f"HTTP {resp.status_code}"
            except httpx.TimeoutException:
                last_error = "Download timed out"
            except httpx.ConnectError:
                last_error = "Could not connect to file host"
            except Exception as e:
                if "Access denied" in str(e) or "not found" in str(e):
                    raise
                last_error = str(e)

        raise Exception(last_error or "Download failed after retries")


def calculate_confidence(fields: dict) -> float:
    """Score from 0-1 based on how many fields were extracted."""
    weights = {
        "full_name": 0.25,
        "email": 0.25,
        "phone": 0.15,
        "linkedin_url": 0.1,
        "current_company": 0.15,
        "current_designation": 0.1,
    }
    score = 0.0
    for field, weight in weights.items():
        if fields.get(field):
            score += weight
    return round(score, 2)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
