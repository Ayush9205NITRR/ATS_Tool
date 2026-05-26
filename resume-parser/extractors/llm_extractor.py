"""
LLM-based field extractor using Google Gemini Flash (free tier).
Falls back to regex extractor if API key not set or call fails.
"""
import os
import re
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

_PROMPT = """You are a resume parser. Extract the following fields from the resume text below.
Return ONLY a valid JSON object — no markdown, no explanation.

Fields:
- full_name: Candidate's full name (2+ words). Never return a single honorific like "Mr" or "Dr".
- email: Primary personal email address.
- phone: Mobile/phone number — digits only, no spaces or dashes (10 digits for Indian numbers).
- linkedin_url: Full LinkedIn profile URL or null.
- current_company: The name of the most recent employer (company/organisation name only — NOT the job title).
- current_designation: The most recent job title/role (NOT the company name).

Rules:
- current_company must be the company name only — e.g. "Scaler Technology", "Global Graduate Consultants".
  Never include the job title, date range, or location in current_company.
- current_designation must be the role only — e.g. "Business Development Associate", "Sales Executive".
  Never include the company name in current_designation.
- For null fields, use JSON null.
- Return only the JSON object, nothing else.

Resume text (first 3000 chars):
\"\"\"
{text}
\"\"\"

JSON:"""


def extract_fields_with_llm(text: str) -> Optional[dict]:
    """
    Call Gemini Flash to extract structured fields.
    Returns dict on success, None on failure (caller should fallback to regex).
    """
    if not GEMINI_API_KEY:
        return None

    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(
            "gemini-1.5-flash",
            generation_config={"temperature": 0, "max_output_tokens": 512},
        )

        prompt = _PROMPT.format(text=text[:3000])
        response = model.generate_content(prompt)
        raw = response.text.strip()

        # Strip markdown code fences if present
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
        raw = raw.strip()

        data = json.loads(raw)

        # Normalise and validate
        result = {
            "full_name":           _clean_str(data.get("full_name")),
            "email":               _clean_str(data.get("email"), lower=True),
            "phone":               _clean_phone(data.get("phone")),
            "linkedin_url":        _clean_str(data.get("linkedin_url")),
            "current_company":     _clean_str(data.get("current_company")),
            "current_designation": _clean_str(data.get("current_designation")),
        }

        # Sanity-check name
        name = result["full_name"] or ""
        if len(name.split()) < 2 or len(name) < 4:
            result["full_name"] = ""

        logger.info("[LLM] Extraction succeeded")
        return result

    except Exception as e:
        logger.warning(f"[LLM] Extraction failed: {e}")
        return None


def _clean_str(val, lower: bool = False) -> Optional[str]:
    if not val or not isinstance(val, str):
        return None
    val = val.strip()
    if val.lower() in ("null", "none", "n/a", "na", ""):
        return None
    return val.lower() if lower else val


def _clean_phone(val) -> Optional[str]:
    if not val:
        return None
    digits = re.sub(r"\D", "", str(val))
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10:
        return digits
    return None
