# Resume Parser API

Self-hosted, free resume parser API for the ATS Tool. Extracts candidate information from resume URLs (PDF, DOCX, DOC, RTF, TXT).

## Quick Start

```bash
cd resume-parser
pip install -r requirements.txt
python main.py
```

Server runs on `http://localhost:8000`

## API Usage

### Parse Resume
```bash
POST /parse
Content-Type: application/json

{
  "url": "https://drive.google.com/file/d/abc123/view?usp=sharing"
}
```

### Response
```json
{
  "success": true,
  "data": {
    "full_name": "Priya Sharma",
    "email": "priya.sharma@gmail.com",
    "phone": "9876543210",
    "linkedin_url": "https://linkedin.com/in/priyasharma",
    "current_company": "TCS",
    "current_designation": "Senior Software Engineer",
    "confidence": 0.85,
    "warnings": []
  }
}
```

## Supported URL Sources
- Google Drive (file/d/... and open?id=...)
- Dropbox
- OneDrive / SharePoint
- Box
- Any direct download link

## Supported File Formats
- PDF (text-based)
- DOCX
- DOC (legacy)
- RTF
- TXT
- HTML

## Deployment

### Docker
```bash
docker build -t resume-parser .
docker run -p 8000:8000 resume-parser
```

### Railway / Render (Free tier)
1. Push this folder to a git repo
2. Connect to Railway/Render
3. Set start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

## Environment Variables
- `PORT` — Server port (default: 8000)

## Connect to ATS Frontend
Add to your `.env`:
```
VITE_RESUME_PARSER_URL=http://localhost:8000/parse
```
