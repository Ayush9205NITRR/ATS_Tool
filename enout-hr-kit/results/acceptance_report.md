# Acceptance test — 2026-11-01 09:12

Site: http://127.0.0.1:8001

**40 passed, 0 failed, 0 skipped** in 72 s

| ID | Check | Result | Notes |
|---|---|---|---|
| F00 | Create test people, shift, leave policy, salary | PASS |  |
| C01 | Scheduler is on (auto attendance, emails, reminders) | PASS |  |
| C02 | Company holiday list for this year with weekly offs | PASS | Enout Technologies 2026: 59 days |
| C03 | Leave types and observance holiday list | PASS |  |
| C04 | Shift with auto attendance + late marking | PASS | processes attendance after 2026-11-01 |
| C05 | HR settings + payroll based on attendance | PASS |  |
| C06 | Role profiles Admin / HR / Manager / Employee | PASS |  |
| C07 | Every employee: eSSL ID (unique), login, shift, approver | PASS | 52 active employees OK |
| C08 | Every employee has leave balances (policy or Keka import) | PASS | 52 employees set up; no balance (0 in Keka?): Annual Leave ×1, Observance Leave ×19 |
| C09 | Every employee has a salary structure | PASS |  |
| C10 | eSSL sync user: works, not an admin | PASS |  |
| R01 | Employee sees only own employee record | PASS |  |
| R02 | Employee cannot create attendance / see salary structures / change eSSL ID | PASS |  |
| R03 | Employee cannot see others' attendance, leaves, payslips, punches | PASS |  |
| R04 | Manager sees own team only, no payroll admin | PASS |  |
| R05 | HR sees all employees | PASS | HR sees all 56 active employees |
| R06 | eSSL sync user cannot read payroll or create users | PASS |  |
| L01 | Employee applies, manager approves, balance drops by 1 | PASS | 4 → 3 (test joiner gets a pro-rated balance) |
| L02 | Employee cannot approve own leave | PASS |  |
| L03 | Overlapping leave is refused | PASS |  |
| L04 | Leave beyond balance is refused | PASS |  |
| L05 | Half-day sick leave counts 0.5 | PASS |  |
| L06 | Weekly off / holiday inside a leave is not counted | PASS | 3 days incl. 1 off-day → 2.0 leave |
| L07 | Observance leave only on observance dates | PASS | allowed on 2026-11-10, refused on 2026-11-11 |
| A01 | Unknown eSSL ID is refused (not silently lost) | PASS |  |
| A02 | eSSL punch without device location is refused | PASS | set latitude/longitude for every device in essl_config.json |
| A03 | eSSL punches accepted with their real punch time | PASS | 7 punches over 4 days, real times kept |
| A04 | Duplicate punch is refused (re-running sync is safe) | PASS |  |
| A05 | Approved past leave | PASS |  |
| A06 | Auto attendance runs | PASS |  |
| A07 | IN 09:20 + OUT 18:40 → Present, ~9.3 h | PASS | 9.33 h |
| A08 | IN 10:05 → Late | PASS |  |
| A09 | Only 3 h worked → Half Day | PASS |  |
| A10 | Forgot to punch OUT → result | PASS | IN only (forgot OUT) → Absent (flagged as single punch in daily summary) |
| A11 | No punch on a working day → Absent | PASS |  |
| A12 | Approved leave day → On Leave | PASS |  |
| A14 | Late-arriving punches turn an auto Absent into Present | PASS | auto Absent → Present after punches arrived late |
| A13 | Web check-in: needs location, only for yourself, can't back-date | PASS | back-dated time ignored: server time used |
| P01 | Salary slip: Basic prorated, PF 1800, PT 200, absences cut pay | PASS | Oct 2026: working days 25, payment days 19.5 (absent 5.5, half day counted), gross ₹46,800, net ₹44,800 |
| P02 | Employee sees own payslip, colleague cannot | PASS |  |
