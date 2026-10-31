@echo off
REM eSSL -> Frappe HR daily sync (Windows office PC).
REM Run once every morning (before office hours). One run completes YESTERDAY:
REM present, late, half day and absent (Frappe marks absent one day later by design).
REM Schedule it (run once in an Administrator command prompt):
REM   schtasks /create /tn "Enout eSSL Sync" /tr "C:\enout-hr-kit\essl\run_daily_sync.bat" /sc daily /st 08:00 /ru SYSTEM
REM PC was off for a few days? The next run catches up automatically (up to 31 days).
cd /d "%~dp0"
python essl_daily_sync.py --config essl_config.json
exit /b %ERRORLEVEL%
