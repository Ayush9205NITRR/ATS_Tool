# Frappe HR for Enout: eSSL, deployment and load-test runbook

Companion to `frappe_hr_founder_demo.mp4`. Everything here was run on a Frappe HR v15
install with demo data (506 employees) on 31 Oct 2026. Items marked **assumption** or
**verify** were not tested against our real hardware or accounts.

## 1. Architecture

```
eSSL devices ──LAN, TCP 4370──▶ Office PC (always on)
                                  frappe/biometric-attendance-sync-tool
                                  polls every 10 min, pushes over HTTPS (API key)
                                         │
                                         ▼
Remote staff (mobile app) ─▶ Cloudflare Tunnel: hr.<our-domain> ─▶ Frappe HR server
HR / Admin (browser)     ─▶   free SSL, no open ports              Frappe HR + ERPNext core
                                                                    MariaDB, Redis
                                                                    Oracle free VM or office PC
```

## 2. Connecting eSSL

1. **Check the device protocol first (2 minutes).** From any PC on the office LAN:
   ```bash
   pip install pyzk
   ```
   ```bash
   python -c "from zk import ZK; c=ZK('192.168.1.201',port=4370).connect(); print(len(c.get_attendance()),'punches'); c.disconnect()"
   ```
   If it prints a count, the official sync tool will work. If it times out, the model may
   only push to eTimeTrackLite or eSSL cloud. In that case, sync from that software's
   database or API instead (**verify** for our model).
2. **On each eSSL device:** give it a static IP and keep port 4370 (Menu → Comm → Ethernet).
3. **In Frappe HR, on each employee:** set *Attendance Device ID* to the employee's eSSL user ID.
4. **Create the sync API user.** In Frappe HR create a user (e.g. `essl-sync@…`) with the
   **HR User** role, then use *Settings → API Access → Generate Keys*.
5. **Set up a shift with auto attendance.** Shift Type → enable *Auto Attendance*, and set the
   grace period, half-day and absent thresholds. Assign it as each employee's *Default Shift*.
6. **On the office PC:** install the official tool
   (<https://github.com/frappe/biometric-attendance-sync-tool>) and fill `local_config.py`:
   ```python
   ERPNEXT_URL = 'https://hr.our-domain.in'
   ERPNEXT_API_KEY = '...'
   ERPNEXT_API_SECRET = '...'
   ERPNEXT_VERSION = 15
   PULL_FREQUENCY = 10
   devices = [{'device_id': 'ESSL_MAIN_GATE', 'ip': '192.168.1.201', 'punch_direction': 'AUTO',
               'clear_from_device_on_fetch': False, 'latitude': 19.0760, 'longitude': 72.8777}]
   shift_type_device_mapping = [{'shift_type_name': ['General Shift'], 'related_device_id': ['ESSL_MAIN_GATE']}]
   ```
   Run it as a service: `erpnext_sync_win.py` on Windows, or a systemd unit on Linux.

> **Gotcha found in testing:** if *HR Settings → Allow Geolocation Tracking* is on (needed for
> mobile GPS check-in), Frappe **rejects punches that have no coordinates**. Every device entry
> must set `latitude`/`longitude` to the office's location.

**Demo result** (`essl_sync_demo.py`). This uses the same API calls as the official tool,
against a simulated device:

- 959 punches from 2 devices were pushed in 47 s with 0 failures.
- Auto attendance then marked 471 Present (176 late) and 2 Absent, in 32 s.

## 3. Deployment (recommended: ₹0 hosting)

**Server.** Oracle Cloud *Always Free* ARM VM, Ubuntu 22.04/24.04.
- The free ARM allowance is reported as 2 OCPU / 12 GB since June 2026. **Verify** in the account.
- Fallback: an always-on office PC running Ubuntu.

**Install Frappe HR v15.** Use a non-root sudo user. Prerequisites:
- Python 3.10–3.12
- Node 18+ and yarn
- MariaDB 10.6+ with `utf8mb4` settings
- Redis
- wkhtmltopdf, for PDF payslips

```bash
pip install frappe-bench
```
```bash
bench init --frappe-branch version-15 frappe-bench && cd frappe-bench
```
```bash
bench get-app --branch version-15 erpnext && bench get-app --branch version-15 hrms
```
```bash
bench new-site hr.our-domain.in --install-app erpnext --install-app hrms
```
```bash
sudo bench setup production $USER
```

**Expose it with our existing Cloudflare account** (Tunnel, free plan):
```bash
cloudflared tunnel login
```
```bash
cloudflared tunnel create frappe-hr
```
```bash
cloudflared tunnel route dns frappe-hr hr.our-domain.in
```
Then put this in `/etc/cloudflared/config.yml`:
```yaml
tunnel: <TUNNEL_ID>
credentials-file: /home/<user>/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: hr.our-domain.in
    service: http://localhost:80
  - service: http_status:404
```
```bash
sudo cloudflared service install
```

**Security checklist**
- Change the Administrator password right after setup.
- The sync user gets the HR User role only.
- Optional: put a Cloudflare Access login wall in front of `/app` (the admin desk).
- Keep the eSSL devices on the LAN only. They never need internet access.

**Backups.** Frappe → *S3 Backup Settings* pointing at Cloudflare R2 (S3-compatible), or the
built-in Google Drive backup. Check that a restore works once a month.

**Managed alternative.** Frappe Cloud costs about $25/mo (around ₹2,100). Support plans start
around ₹4,100/mo. It runs the same software, so we can move between self-hosted and managed
without a migration project.

## 4. Load test

**Setup**
- Server: gunicorn, 4 workers × 4 threads, which is the production config.
- Hardware: **one 4-vCPU / 16 GB machine running MariaDB, Redis, Frappe *and* the load
  generator**. A real server doesn't share CPU with the load generator, so treat these numbers
  as conservative.
- Tool: Locust 2.47 (`loadtest/locustfile.py`).
- Employee numbers are steady state, measured after all users had logged in
  (`--reset-stats`, ramp 10 users/s).

| Scenario | Throughput | p50 | p95 | Success | Verdict |
|---|---|---|---|---|---|
| eSSL punch ingestion, 10 parallel streams, no wait | 40 punches/s (2,343 in 60 s) | 0.28 s | 0.35 s | 100% | OK |
| 100 employees active at once (1–3 s between taps) | 47 req/s | 0.025 s | 0.11 s | 99.98% | OK |
| 200 employees active at once | 84 req/s | 0.04 s | 0.31 s | 99.96% | OK |
| 400 employees active at once | 107 req/s | 0.54 s | 15 s | 99.8% | Saturated |

**Notes**
- Success rates exclude "same timestamp" duplicate-punch rejections. Those came from the test
  reusing timestamps across runs, and Frappe correctly refused them.
- The remaining failures at 200 and 400 users are connection resets under saturation.
- Login is deliberately CPU-heavy because of password hashing. Spawning 25 new logins/s pushed
  login p50 to about 7 s on this box. Real users log in rarely and stay logged in.

**Interpretation**
- *Morning rush:* 500 people punching in within 15 minutes is about 0.6 punches/s. Measured
  capacity is 40/s, roughly 70× headroom.
- *Oracle free VM:* it has fewer cores than the test box, so expect about half (**assumption**).
  That is still around 30× the morning rush.
- *App concurrency:* 200 simultaneously active users stayed under 0.31 s at p95. How headcount
  maps to "active at once" depends on usage (**assumption**). Most staff open the app a few
  times a day.

**Scaling path**, in order:
1. More gunicorn workers.
2. A bigger VM.
3. MariaDB on its own server.
4. Frappe Cloud dedicated server.

The software stays the same at every step.

**Re-run the load test**
```bash
pip install locust
```
```bash
HR_HOST_HEADER=hr.our-domain.in EMPLOYEE_WEIGHT=1 ESSL_WEIGHT=0 locust -f loadtest/locustfile.py --headless -u 100 -r 10 -t 100s --reset-stats --host https://hr.our-domain.in
```
The test needs `loadtest_users.json` (test logins) and `essl_api.json` (API key). Generate
them with `seed_scale.py`, which is **demo data only**. Never run it on production.

## 5. Rollout plan

1. **Day 1.** Run the pyzk test on our eSSL device.
2. **Day 1–2.** Create the Oracle VM, install Frappe HR, and connect `hr.<domain>` through
   Cloudflare Tunnel.
3. **Day 2–3.** Import employees with their eSSL IDs. Set up:
   - leave types: CL 12, SL 8, Observance 2 with an optional-holiday list
   - holidays
   - salary structure and state Professional Tax
4. **Weeks 1–4.** Run in parallel with the current process, and compare attendance and one
   payroll cycle.
5. **Go live.** Roll the mobile app out to remote staff.

## Files

| File | What it is |
|---|---|
| `frappe_hr_founder_demo.mp4` | 4:44 captioned demo video |
| `slides/` | Slide images used in the video |
| `essl_sync_demo.py` | Demo sync script that uses the official tool's API calls, with a simulated device |
| `seed_scale.py` | Demo dataset: 500 employees, shift, API user, test logins |
| `loadtest/locustfile.py` | Load test |
| `loadtest/results/` | Locust CSV and HTML reports for each scenario |
