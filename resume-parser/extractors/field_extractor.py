"""
Field Extractor — uses regex, heuristics, and NLP to extract structured
fields from raw resume text. Highly robust with multiple fallback strategies.
"""
import re
from typing import Optional

import phonenumbers


def extract_all_fields(text: str) -> dict:
    """Master extraction function — returns all fields with best-effort values."""
    result = {}

    result["email"] = extract_email(text) or ""
    result["phone"] = extract_phone(text)
    result["linkedin_url"] = extract_linkedin(text)
    result["full_name"] = extract_name(text, result.get("email", ""))
    result["current_company"] = extract_current_company(text)
    result["current_designation"] = extract_current_designation(text)

    return result


# ═══════════════════════════════════════════════════════════════════
# EMAIL EXTRACTION
# ═══════════════════════════════════════════════════════════════════
def extract_email(text: str) -> Optional[str]:
    """Extract the most likely personal email from resume text."""
    # Comprehensive email regex
    email_pattern = re.compile(
        r"[a-zA-Z0-9][a-zA-Z0-9._%+\-]*@[a-zA-Z0-9][a-zA-Z0-9.\-]*\.[a-zA-Z]{2,}",
        re.IGNORECASE,
    )
    emails = email_pattern.findall(text)

    if not emails:
        return None

    # Filter out common non-personal emails
    SKIP_DOMAINS = {
        "example.com", "email.com", "company.com", "domain.com",
        "noreply", "support", "info@", "hr@", "admin@",
        "sampleresume", "template",
    }

    personal_emails = []
    for email in emails:
        email_lower = email.lower()
        if any(skip in email_lower for skip in SKIP_DOMAINS):
            continue
        # Skip image file references mistaken as emails
        if re.search(r"\.(png|jpg|jpeg|gif|svg|ico)$", email_lower):
            continue
        personal_emails.append(email)

    if not personal_emails:
        return emails[0].lower()  # Return first found as fallback

    # Prefer gmail/outlook/yahoo/personal domain over corporate
    PERSONAL_DOMAINS = {"gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "protonmail.com", "icloud.com"}
    for em in personal_emails:
        domain = em.split("@")[1].lower()
        if domain in PERSONAL_DOMAINS:
            return em.lower()

    return personal_emails[0].lower()


# ═══════════════════════════════════════════════════════════════════
# PHONE EXTRACTION
# ═══════════════════════════════════════════════════════════════════
def extract_phone(text: str) -> Optional[str]:
    """Extract phone number — handles Indian, US, UK, and international formats."""
    # Strategy 1: Use phonenumbers library (most robust)
    phone_from_lib = _extract_phone_library(text)
    if phone_from_lib:
        return phone_from_lib

    # Strategy 2: Regex patterns for common formats
    patterns = [
        # Indian: +91 XXXXX XXXXX, 91-XXXXXXXXXX, etc.
        r"(?:\+?91[\s\-.]?)?\d{5}[\s\-.]?\d{5}",
        # General: (XXX) XXX-XXXX, XXX-XXX-XXXX
        r"\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}",
        # With country code: +1-XXX-XXX-XXXX
        r"\+\d{1,3}[\s\-.]?\d{2,5}[\s\-.]?\d{3,5}[\s\-.]?\d{3,5}",
        # Plain 10 digits
        r"(?<!\d)\d{10}(?!\d)",
    ]

    # Look near phone-related keywords first
    phone_context = _get_context_near_keywords(
        text, ["phone", "mobile", "cell", "contact", "tel", "mob", "ph"]
    )

    for search_text in [phone_context, text]:
        for pattern in patterns:
            matches = re.findall(pattern, search_text)
            for match in matches:
                digits = re.sub(r"\D", "", match)
                # Validate length
                if 10 <= len(digits) <= 13:
                    # Normalize Indian numbers
                    if len(digits) == 12 and digits.startswith("91"):
                        return digits[2:]
                    if len(digits) == 11 and digits.startswith("0"):
                        return digits[1:]
                    if len(digits) == 10:
                        return digits
                    return digits
        if phone_context and search_text == phone_context:
            continue
        break

    return None


def _extract_phone_library(text: str) -> Optional[str]:
    """Use phonenumbers library to find valid phone numbers."""
    try:
        # Try Indian region first (most common for this ATS)
        for region in ["IN", "US", "GB", None]:
            for match in phonenumbers.PhoneNumberMatcher(text, region):
                number = match.number
                if phonenumbers.is_valid_number(number):
                    national = phonenumbers.format_number(
                        number, phonenumbers.PhoneNumberFormat.NATIONAL
                    )
                    digits = re.sub(r"\D", "", national)
                    if len(digits) == 10:
                        return digits
                    if len(digits) == 11 and digits.startswith("0"):
                        return digits[1:]
                    return digits
    except:
        pass
    return None


# ═══════════════════════════════════════════════════════════════════
# LINKEDIN EXTRACTION
# ═══════════════════════════════════════════════════════════════════
def extract_linkedin(text: str) -> Optional[str]:
    """Extract LinkedIn profile URL."""
    patterns = [
        r"(?:https?://)?(?:www\.)?linkedin\.com/in/[a-zA-Z0-9\-_%]+/?",
        r"(?:https?://)?(?:www\.)?linkedin\.com/pub/[a-zA-Z0-9\-_%/]+/?",
        r"linkedin\.com/in/[a-zA-Z0-9\-_%]+",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            url = match.group(0)
            if not url.startswith("http"):
                url = "https://" + url
            return url.rstrip("/")

    return None


# ═══════════════════════════════════════════════════════════════════
# NAME EXTRACTION
# ═══════════════════════════════════════════════════════════════════
def extract_name(text: str, email: str = "") -> str:
    """
    Extract candidate's full name. Uses multiple strategies:
    1. First non-trivial line (resumes typically start with the name)
    2. Email prefix heuristic
    3. Pattern matching near "Name:" labels
    """
    # Strategy 1: Look for explicit "Name:" label
    name_label_patterns = [
        r"(?:name|full\s*name|candidate\s*name)\s*[:\-–]\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})",
    ]
    for pattern in name_label_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            name = match.group(1).strip()
            if _is_valid_name(name):
                return _clean_name(name)

    # Strategy 2: First meaningful line (most common resume format)
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    for line in lines[:5]:  # Check first 5 lines
        # Skip lines that look like headers, contacts, or labels
        if _is_likely_name_line(line):
            name = _extract_name_from_line(line)
            if name and _is_valid_name(name):
                return _clean_name(name)

    # Strategy 3: Derive from email
    if email:
        name_from_email = _name_from_email(email)
        if name_from_email:
            return name_from_email

    # Strategy 4: Look for capitalized word sequences
    cap_pattern = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b")
    for line in lines[:10]:
        match = cap_pattern.search(line)
        if match:
            candidate = match.group(1)
            if _is_valid_name(candidate) and len(candidate) > 3:
                return _clean_name(candidate)

    return ""


def _is_likely_name_line(line: str) -> bool:
    """Check if a line likely contains just a name."""
    skip_indicators = [
        "@", "http", "www.", "phone", "tel:", "mobile", "address",
        "resume", "curriculum", "vitae", "objective", "summary",
        "experience", "education", "skill", "project",
        "|", "•", "●", "■", "+91", "linkedin", "github",
    ]
    line_lower = line.lower()
    if any(ind in line_lower for ind in skip_indicators):
        return False

    # Names need at least 2 words (first + last name minimum)
    words = line.split()
    if len(words) < 2 or len(words) > 5:
        return False
    if len(line) > 60:
        return False

    # Each word must be at least 2 chars
    if any(len(w) < 2 for w in words):
        return False

    # Should contain mostly letters
    alpha_ratio = sum(1 for c in line if c.isalpha() or c.isspace()) / max(len(line), 1)
    if alpha_ratio < 0.85:
        return False

    # First word must start with uppercase
    if not words[0][0].isupper():
        return False

    return True


def _extract_name_from_line(line: str) -> str:
    """Clean a line to extract just the name portion."""
    # Remove common prefixes/suffixes
    line = re.sub(r"^(Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?)\s*", "", line, flags=re.IGNORECASE)
    line = re.sub(r"\s*(resume|cv|curriculum vitae).*$", "", line, flags=re.IGNORECASE)
    # Remove parenthetical content
    line = re.sub(r"\([^)]*\)", "", line)
    # Remove trailing punctuation
    line = line.strip(" .,;:-–—")
    return line.strip()


def _is_valid_name(name: str) -> bool:
    """Validate that a string looks like a real name."""
    if not name or len(name) < 2:
        return False
    words = name.split()
    if len(words) < 1 or len(words) > 5:
        return False

    # Each word should be mostly alphabetic
    for word in words:
        alpha_chars = sum(1 for c in word if c.isalpha())
        if alpha_chars < len(word) * 0.7:
            return False

    # Must be at least 4 chars total (avoids "ile", "Mr" etc.)
    if len(name) < 4:
        return False

    # Must have at least 2 words
    if len(words) < 2:
        return False

    # Not a common non-name word
    NON_NAMES = {
        "resume", "curriculum", "vitae", "objective", "summary",
        "experience", "education", "skills", "projects", "profile",
        "contact", "address", "phone", "email", "linkedin",
        "professional", "personal", "details", "information",
        "mr", "mrs", "ms", "dr", "sir", "prof",
    }
    if name.lower() in NON_NAMES or words[0].lower() in NON_NAMES:
        return False

    return True


def _clean_name(name: str) -> str:
    """Normalize name formatting."""
    # Title case each word
    parts = name.split()
    cleaned = []
    for part in parts:
        if part.isupper() and len(part) > 2:
            # ALL CAPS -> Title Case
            cleaned.append(part.capitalize())
        else:
            cleaned.append(part)
    return " ".join(cleaned)


def _name_from_email(email: str) -> Optional[str]:
    """Attempt to derive a name from an email address."""
    local = email.split("@")[0]
    # Remove digits
    local = re.sub(r"\d+", "", local)
    # Split on common separators
    parts = re.split(r"[._\-+]", local)
    parts = [p for p in parts if len(p) > 1]

    if len(parts) >= 2:
        return " ".join(p.capitalize() for p in parts[:3])
    elif len(parts) == 1 and len(parts[0]) > 2:
        # Try camelCase split
        camel_split = re.sub(r"([a-z])([A-Z])", r"\1 \2", parts[0])
        if " " in camel_split:
            return camel_split.title()
    return None


# ═══════════════════════════════════════════════════════════════════
# COMPANY EXTRACTION
# ═══════════════════════════════════════════════════════════════════
def extract_current_company(text: str) -> Optional[str]:
    """Extract current/most recent company name."""
    # Strategy 1: Look for explicit labels
    label_patterns = [
        r"(?:current\s+(?:company|organization|employer|org))\s*[:\-–]\s*(.+?)(?:\n|$)",
        r"(?:company|organization|employer)\s*[:\-–]\s*(.+?)(?:\n|$)",
        r"(?:working\s+at|employed\s+at|employed\s+with)\s+(.+?)(?:\n|,|$)",
    ]
    for pattern in label_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            company = match.group(1).strip().strip(".,;")
            if company and len(company) > 1 and len(company) < 80:
                return company

    # Strategy 2: Look in experience section for the first/most recent entry
    exp_section = _extract_section(text, [
        "experience", "work experience", "professional experience",
        "employment", "work history", "career"
    ])

    if exp_section:
        # Look for company names (often in bold or on their own line, preceded by dates)
        lines = [l.strip() for l in exp_section.split("\n") if l.strip()]
        for i, line in enumerate(lines[:10]):
            # Skip date-only lines
            if re.match(r"^\d{4}\s*[\-–]\s*(?:\d{4}|present|current|till\s*date)", line, re.IGNORECASE):
                continue
            # Skip designation-looking lines (too generic)
            if re.match(r"^(senior|junior|lead|sr|jr|chief|head|vp|director|manager)", line, re.IGNORECASE):
                # This might be the designation — next line could be company
                if i + 1 < len(lines):
                    candidate = lines[i + 1].strip(" |•●■–-.,")
                    if _is_valid_company(candidate):
                        return candidate[:80]
                continue

            # Check if this line looks like a company name
            cleaned = line.strip(" |•●■–-.,")
            cleaned = _strip_date_ranges(cleaned)

            if cleaned and _is_valid_company(cleaned):
                return cleaned[:80]

    return None


def _is_valid_company(name: str) -> bool:
    """Check if string looks like a company name."""
    if not name or len(name) < 2 or len(name) > 100:
        return False

    # Skip common section headers
    SKIP = {
        "experience", "education", "skills", "projects", "summary",
        "objective", "profile", "interests", "hobbies", "references",
        "achievements", "certifications", "languages", "awards",
    }
    if name.lower().strip() in SKIP:
        return False

    # Should have at least one word with 2+ chars
    words = name.split()
    if not any(len(w) >= 2 for w in words):
        return False

    return True


# ═══════════════════════════════════════════════════════════════════
# DESIGNATION EXTRACTION
# ═══════════════════════════════════════════════════════════════════
def extract_current_designation(text: str) -> Optional[str]:
    """Extract current/most recent job title/designation."""
    # Strategy 1: Explicit labels
    label_patterns = [
        r"(?:current\s+)?(?:designation|title|position|role)\s*[:\-–]\s*(.+?)(?:\n|$)",
        r"(?:working\s+as|currently\s+as|role)\s*[:\-–]?\s*(.+?)(?:\n|,|\s+at\s+|$)",
    ]
    for pattern in label_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            title = _clean_designation(match.group(1).strip().strip(".,;"))
            if title and len(title) > 2 and len(title) < 80:
                return title

    # Strategy 2: Look in experience section
    exp_section = _extract_section(text, [
        "experience", "work experience", "professional experience",
        "employment", "work history",
    ])

    if exp_section:
        # Common job title patterns
        TITLE_KEYWORDS = [
            r"(?:senior|junior|lead|sr\.?|jr\.?|chief|head|principal|staff)?\s*"
            r"(?:software|web|mobile|full[\s-]?stack|front[\s-]?end|back[\s-]?end|data|ml|ai|cloud|devops|qa|ui/ux|product|project|program|business|marketing|sales|hr|finance|operations)?\s*"
            r"(?:engineer|developer|architect|designer|analyst|manager|consultant|specialist|coordinator|associate|executive|intern|trainee|officer|administrator|lead|director|vp|scientist|researcher)",
        ]

        lines = [l.strip() for l in exp_section.split("\n") if l.strip()]
        for line in lines[:8]:
            cleaned = line.strip(" |•●■–-.,")
            cleaned = _strip_date_ranges(cleaned)

            for pattern in TITLE_KEYWORDS:
                match = re.search(pattern, cleaned, re.IGNORECASE)
                if match:
                    title = _clean_designation(match.group(0).strip())
                    if title and len(title) > 3:
                        return title[:80]

    return None


# ═══════════════════════════════════════════════════════════════════
# UTILITY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════

_MONTH = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
_END_DATE = rf"(?:{_MONTH}\s+\d{{4}}|present|current|ongoing|till\s*date)"

def _strip_date_ranges(text: str) -> str:
    """Remove all date range patterns (year-based and month-name-based) from a string."""
    # "Jan 2025 – Oct 2025" / "Jan 2025 - present"
    text = re.sub(
        rf"\s*[,|]?\s*{_MONTH}\s+\d{{4}}\s*[-–]\s*{_END_DATE}",
        "", text, flags=re.IGNORECASE
    )
    # Standalone "Jan 2025" at end
    text = re.sub(rf"\s*[,|]?\s*{_MONTH}\s+\d{{4}}\s*$", "", text, flags=re.IGNORECASE)
    # "2024 – 2025" / "2024 – present"
    text = re.sub(
        r"\s*[\(]?\s*\d{4}\s*[-–]\s*(?:\d{4}|present|current|till\s*date|ongoing)\s*[\)]?",
        "", text, flags=re.IGNORECASE
    )
    return text.strip(" |•●■–-.,")


def _clean_designation(title: str) -> str:
    """Remove sentence fragments from a designation string."""
    # Cut at conjunctions that signal a sentence, not a title
    cut_pattern = re.compile(
        r"\s+(?:where|while|and\s+I|in\s+which|to\s+(?:work|help|support|contribute|manage)|"
        r"working|reporting|based|located)\b",
        re.IGNORECASE
    )
    m = cut_pattern.search(title)
    if m:
        title = title[:m.start()]

    # Strip trailing "at <Company>" or "with <Company>"
    title = re.sub(r"\s+(?:at|with|for|in)\s+\S.*$", "", title, flags=re.IGNORECASE)

    title = title.strip(" .,;:-–")

    # Reject if it still looks like a sentence (> 6 words or contains lowercase-start words mid-string)
    words = title.split()
    if len(words) > 7:
        return ""
    return title


def _extract_section(text: str, section_names: list[str]) -> Optional[str]:
    """Extract a section of the resume by its header name."""
    # Build pattern to find section header
    names_pattern = "|".join(re.escape(n) for n in section_names)
    # Section headers are typically on their own line, possibly with decorators
    header_pattern = re.compile(
        rf"^[\s•●■\-=_]*({names_pattern})[\s:•●■\-=_]*$",
        re.IGNORECASE | re.MULTILINE,
    )

    match = header_pattern.search(text)
    if not match:
        # Try less strict matching
        loose_pattern = re.compile(
            rf"({names_pattern})\s*[:\-–]?\s*\n",
            re.IGNORECASE,
        )
        match = loose_pattern.search(text)

    if not match:
        return None

    start = match.end()

    # Find the end of this section (next section header)
    ALL_SECTIONS = [
        "experience", "education", "skills", "projects", "summary",
        "objective", "profile", "interests", "hobbies", "references",
        "achievements", "certifications", "languages", "awards",
        "publications", "training", "courses", "activities",
        "work experience", "professional experience", "employment",
        "technical skills", "personal details", "declaration",
    ]
    next_header_pattern = re.compile(
        r"^[\s•●■\-=_]*(" + "|".join(re.escape(s) for s in ALL_SECTIONS) + r")[\s:•●■\-=_]*$",
        re.IGNORECASE | re.MULTILINE,
    )

    next_match = next_header_pattern.search(text[start:])
    if next_match:
        end = start + next_match.start()
    else:
        end = min(start + 3000, len(text))  # Limit section size

    return text[start:end].strip()


def _get_context_near_keywords(text: str, keywords: list[str], window: int = 100) -> str:
    """Get text context near specified keywords."""
    contexts = []
    text_lower = text.lower()
    for kw in keywords:
        idx = text_lower.find(kw.lower())
        if idx != -1:
            start = max(0, idx - 20)
            end = min(len(text), idx + window)
            contexts.append(text[start:end])
    return " ".join(contexts)
