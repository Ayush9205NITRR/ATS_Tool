# Enout HR: go-live guide

Follow the steps in order. Each step ends with a check. Don't move on until it passes.

## Who can do what

| Role (CSV `role`) | Signs in at | Can do |
|---|---|---|
| **Admin** (founder / IT) | `https://hr.<domain>/app` | Everything, including settings and users |
| **HR** | `https://hr.<domain>/app` | All employees, attendance, leaves, payroll |
| **Manager** | `https://hr.<domain>/hrms` | Own record + team; approves the team's leave |
| **Employee** | `https://hr.<domain>/hrms` (phone browser, no app) | Own attendance, leave, payslips; GPS check-in |

Built-in safeguards (each one verified by the tests):
- Employees can't see colleagues' data.
- Employees can't change their own eSSL ID, shift or approver.
- Employees can't back-date a check-in.
- Nobody can approve their own leave.
- The eSSL sync account can't read payroll.

---

## 1. Server + Cloudflare (about 45 minutes, mostly waiting)

**1a. Create the server.** Oracle Cloud (free): sign up at cloud.oracle.com; a card is needed for verification only.
- Compute → Instances → **Create instance**.
- Image **Ubuntu 24.04**, shape **Ampere A1**, 2 OCPU, 12 GB RAM.
- Upload your SSH public key, then Create.
- Note the **public IP**.

Any Ubuntu 22.04/24.04 machine with 4 GB+ RAM works too (another VPS, or an always-on office PC).

**1b. Create the Cloudflare Tunnel** (your existing account):
- Zero Trust → Networks → **Tunnels** → Create a tunnel → *Cloudflared* → name it `enout-hr`.
- Copy the **token**: the long string after `cloudflared service install` in the command Cloudflare shows.
- Next → **Public hostname**: subdomain `hr`, your domain, service **HTTP** `localhost:80` → Save.

**1c. Run the installer on the server** (from your Mac terminal):
```bash
ssh ubuntu@<PUBLIC_IP>
```
On the server, get the kit. If the repository is private, GitHub asks for your username and a personal access token:
```bash
git clone -b claude/gallant-ptolemy-luo16h https://github.com/Ayush9205NITRR/ATS_Tool.git
```
```bash
bash ATS_Tool/enout-hr-kit/deploy/install_server.sh hr.<yourdomain> <CLOUDFLARE_TOKEN>
```
It installs Frappe HR v15 + ERPNext, MariaDB, Redis, nginx, auto-start on reboot, backups every 6 hours, and the
tunnel. At the end it prints the **Administrator password** (also saved in `~/enout_secrets.txt`).
It is safe to re-run if it stops halfway.

✅ Check: `https://hr.<yourdomain>` opens the login page, and you can log in as Administrator.

## 2. Admin API key
Log in as Administrator → top-right avatar → **My Settings → API Access → Generate Keys**.
Then, on the machine where you run the kit:
```bash
export FRAPPE_URL=https://hr.<domain> FRAPPE_API_KEY=<key> FRAPPE_API_SECRET=<secret>
```
```bash
pip install -r requirements.txt
```

## 3. Fill in your data
- **`config/enout.json`**: company name, holidays, observance days, and leave days:
  OL (Observance) 2, CL 12, SL 8, AL 15 with up to 15 days carried forward. Also shift times,
  and the salary split and Professional Tax for your state.
  Set `shift.process_attendance_after` to **your go-live date**.
- **`config/employees.csv`**: copy `employees.sample.csv` and use one row per person.
  - `essl_user_id` = the person's user number on the eSSL machine.
  - `role` = Admin / HR / Manager / Employee.
  - `reports_to_email` = their manager; leave it empty for HR and the founder.
  - `monthly_ctc` = monthly gross salary.

## 4. Run setup
```bash
python setup/enout_setup.py --config config/enout.json --employees config/employees.csv --run-wizard
```
It is safe to run again any time (e.g. after adding new joiners to the CSV).
It creates:
- company, holidays, leave types and policy
- shift with auto attendance
- roles, logins, leave approvers
- salary structure
- the eSSL sync account

✅ Check: it ends with `Setup complete.` and there are no `!` warnings.
You'll find:
- `output/initial_passwords.csv`: temporary passwords. Share them privately, then **delete the file**.
- `output/essl_api.json`: needed in step 7.

## 4b. Carry over leave balances from Keka
In Keka, export the **leave balance report**, then save it as a CSV with three columns:
```
email,leave_type,balance
priya.sharma@example.in,CL,7.5
priya.sharma@example.in,AL,18
```
`leave_type` can be OL, CL, SL or AL. Preview first, then import:
```bash
python setup/import_leave_balances.py --config config/enout.json --balances keka_balances.csv --as-of <go-live date> --replace --dry-run
```
```bash
python setup/import_leave_balances.py --config config/enout.json --balances keka_balances.csv --as-of <go-live date> --replace
```
Each balance becomes the person's balance from the go-live date. AL carries forward next year by itself.
Re-running is safe; already-imported rows are skipped.
A 0 balance means no allocation for that type (Frappe can't store 0).

✅ Check: `errors 0`. Spot-check two people against Keka.

## 5. Acceptance test (must be 100%)
```bash
python tests/acceptance_test.py --config config/enout.json
```
It runs 40 checks across config, roles, leave, eSSL attendance and payroll, using its own test people (removed at the end).

✅ Check: `40 passed, 0 failed`. If anything fails, the line says what to fix; fix it and re-run steps 4 and 5.

## 6. Load test (before announcing)
```bash
locust -f tests/load_test.py --headless -u 200 -r 10 -t 3m --reset-stats --host $FRAPPE_URL
```
This is read-only, so it's safe on the live site.

✅ Check: **p95 < 1 s and failures < 0.5%** at 200 users.
If you see `Connection reset` errors, nginx isn't in front of the app; run `bench setup production`.

## 7. eSSL on the office PC (Windows)
1. Install Python 3.11+. Copy the `essl/` and `lib/` folders to `C:\enout-hr-kit\`.
2. Install the dependencies:
   ```bash
   pip install -r essl/requirements.txt
   ```
3. Copy `essl_config.sample.json` → `essl_config.json`.
   - Set `frappe_url`, and each device's `ip`, `latitude` and `longitude` (the office location; **required**).
   - Put `output/essl_api.json` next to it.
4. Check the devices are reachable:
   ```bash
   python essl/essl_daily_sync.py --test
   ```
   ✅ Each device shows `OK` with a user and punch count.
5. Check every device user is linked to an employee:
   ```bash
   python essl/essl_daily_sync.py --check-mapping
   ```
   ✅ Both "on device but not in Frappe" and "in Frappe but not on device" lists should be empty.
   To add missing people onto the machine, run `--enroll --yes`. Fingerprints are still enrolled at the machine.
6. Load the first days:
   ```bash
   python essl/essl_daily_sync.py --from <go-live date> --to <today>
   ```
7. Schedule it once a day at **8 AM** (Administrator command prompt):
   ```bash
   schtasks /create /tn "Enout eSSL Sync" /tr "C:\enout-hr-kit\essl\run_daily_sync.bat" /sc daily /st 08:00 /ru SYSTEM
   ```
   On a Linux PC, use a cron entry instead: `0 8 * * * cd /opt/enout-hr-kit && python3 essl/essl_daily_sync.py`

## 8. Announce
Send each person their login and link (step 1 table). Employees open `https://hr.<domain>/hrms` on their phone.

---

## How the eSSL sync behaves

| Situation | What happens |
|---|---|
| Runs at 8 AM | Pulls all punches, completes **yesterday** (Present / Late / Half Day / Absent) |
| Run it again, any time | Safe: already-saved punches are skipped |
| PC was off for days | The next run catches up automatically (up to 31 days) |
| Device unreachable | Punches from the other devices are saved, but **attendance is not processed** (nobody wrongly marked absent). Exit code 2 |
| Punches arrive after someone was auto-marked Absent | The run re-opens that day and marks them Present |
| Forgot to punch OUT | Marked Absent and flagged "single punch" in `essl/logs/attendance_<date>.csv`. Employee raises an Attendance Request from the phone |
| Unknown eSSL user number | Reported in the log and by `--check-mapping`; nothing is lost |
| Absent shows the next morning | By design: Frappe waits a day before auto-marking Absent so HR can enter corrections |

## Monthly payroll
Payroll is based on **attendance**: Absent days and unpaid leave reduce payment days automatically.
In Frappe: **Payroll → Payroll Entry → New**, select the month, *Get Employees*, *Create Salary Slips*, review, *Submit*.

## What the tests found and fixed before go-live
1. Employees could edit their own eSSL ID. Sensitive fields are now HR-only.
2. HR could only see their own reporting tree. HR and Admin now see everyone.
3. The eSSL sync account could read payslips. It now has a minimal **eSSL Sync** role.
4. With that minimal role, punches were saved with the *sync time* instead of the *punch time*. Fixed, and now tested.
5. The HR head had no leave approver. There's now an approver chain (manager → HR → Admin).
6. eSSL absences didn't reduce pay (Frappe's default is leave-based payroll). Payroll is now attendance-based.
7. PF would have been reduced twice for partial months. Fixed in the salary structure.
8. An offline device or late punches could leave people wrongly Absent. Guarded and self-healing.
9. With more than 1,000 punches in one run, Frappe moved attendance to a background job and hid errors in a
   message, so the daily summary read half-processed data. The sync now processes day by day and checks every
   punch got attendance.
10. Carry-forward leave was capped at the yearly days, which would have rejected Keka AL balances like 18.
    The cap is now annual + carry forward.

## Not tested here (do it on site)
- **A real eSSL machine.** The tests used a simulated device. The real-device code was exercised up to the network
  connection (a timeout against an unreachable IP), but not against hardware. Step 7.4–7.6 is that test.
- **Email** (welcome mails, leave notifications) needs an Email Account in Frappe (Settings → Email Account).
- **Your production server's numbers.** Step 6 measures them.
