"""
URL Resolver — converts sharing links to direct download URLs.
Supports: Google Drive, Dropbox, OneDrive, Box, direct links.
"""
import re
from urllib.parse import urlparse, parse_qs, urlencode


def resolve_download_url(url: str) -> str:
    """Convert a sharing/view URL into a direct download URL."""
    url = url.strip()

    # Google Drive
    if "drive.google.com" in url or "docs.google.com" in url:
        return _resolve_google_drive(url)

    # Dropbox
    if "dropbox.com" in url:
        return _resolve_dropbox(url)

    # OneDrive / SharePoint
    if "onedrive.live.com" in url or "sharepoint.com" in url or "1drv.ms" in url:
        return _resolve_onedrive(url)

    # Box
    if "box.com" in url or "app.box.com" in url:
        return _resolve_box(url)

    # Already a direct link (ends with .pdf, .docx, etc.)
    if _looks_like_direct_download(url):
        return url

    # Unknown — return as-is and hope for the best
    return url


def _resolve_google_drive(url: str) -> str:
    """
    Handles:
    - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
    - https://drive.google.com/open?id=FILE_ID
    - https://docs.google.com/document/d/FILE_ID/edit
    - https://drive.google.com/uc?id=FILE_ID&export=download
    """
    # Already a download link
    if "export=download" in url:
        return url

    file_id = None

    # Pattern: /file/d/FILE_ID/ or /document/d/FILE_ID/
    match = re.search(r"/(?:file|document|presentation|spreadsheets)/d/([a-zA-Z0-9_-]+)", url)
    if match:
        file_id = match.group(1)

    # Pattern: ?id=FILE_ID
    if not file_id:
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        if "id" in params:
            file_id = params["id"][0]

    if not file_id:
        # Last resort: try the URL directly
        return url

    return f"https://drive.google.com/uc?export=download&id={file_id}"


def _resolve_dropbox(url: str) -> str:
    """
    Handles:
    - https://www.dropbox.com/s/xxxxx/resume.pdf?dl=0
    - https://www.dropbox.com/scl/fi/xxxxx/resume.pdf?rlkey=xxx&dl=0
    Convert dl=0 to dl=1 for direct download.
    """
    if "dl=0" in url:
        return url.replace("dl=0", "dl=1")
    if "dl=1" in url:
        return url
    # Add dl=1 parameter
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}dl=1"


def _resolve_onedrive(url: str) -> str:
    """
    OneDrive sharing links — replace 'redir' with 'download'.
    - https://onedrive.live.com/redir?resid=XXX&authkey=XXX
    """
    if "redir" in url:
        return url.replace("redir", "download")
    # For 1drv.ms short links, just return — httpx follows redirects
    return url


def _resolve_box(url: str) -> str:
    """
    Box shared links — append /content for download.
    - https://app.box.com/s/xxxxx -> append ?raw=1
    """
    if "app.box.com/s/" in url:
        # Box API direct download hack
        return url.rstrip("/") + "?raw=1"
    return url


def _looks_like_direct_download(url: str) -> bool:
    """Check if URL likely points directly to a downloadable file."""
    parsed = urlparse(url)
    path = parsed.path.lower()
    extensions = (".pdf", ".docx", ".doc", ".rtf", ".txt", ".odt")
    return any(path.endswith(ext) for ext in extensions)
