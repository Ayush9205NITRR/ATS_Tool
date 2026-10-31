# Enout HR kit

Everything needed to take Frappe HR live for Enout: roles and users, eSSL attendance, payroll, and a final test suite.

**Start here → [GO_LIVE.md](GO_LIVE.md)** (8 steps).

| Folder | What |
|---|---|
| `config/` | Company settings (`enout.json`) and the employee list template (`employees.sample.csv`) |
| `setup/enout_setup.py` | One command that configures everything. Safe to re-run |
| `essl/essl_daily_sync.py` | eSSL → attendance. Run once a day; catches up on its own |
| `tests/acceptance_test.py` | 40 checks across roles, leave, attendance, payroll. Must pass before go-live |
| `tests/load_test.py` | Load test (read-only by default) |
| `results/` | Latest test evidence: 40/40 passed; 200 users, p95 0.15 s, 0 failures |
| `output/` | Created by setup: temporary passwords and the eSSL key. **Never commit; delete after use** |
