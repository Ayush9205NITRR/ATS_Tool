# Enout HR System (Frappe HR)

**Watch:** `frappe_hr_demo_short.mp4` (80 seconds, English voiceover)

## What it does
- **Leaves:** Casual, Sick, Observance
- **Attendance:** pulled from eSSL automatically
- **Remote staff:** web sign-in from the phone browser, with GPS check-in. No app to install, no App Store needed.
- **Payroll:** salary slips in the same system

## How it works
```
eSSL machine → Office PC → Frappe HR (cloud) ← Employee browser
```
Set up once. After that, everything is automatic.

## Tested
| | |
|---|---|
| eSSL punches synced | 959, 0 errors |
| 200 people using it at once | 0.3 s response |
| Cost | ₹0 licence, ₹0 hosting |

## Next steps
1. **Test our eSSL machine** (1 day)
2. **Set up the system** (2 days)
3. **Run side by side for 1 month**, then go live

---
Full details (steps, commands, test reports): [`details/DEPLOYMENT.md`](details/DEPLOYMENT.md)
