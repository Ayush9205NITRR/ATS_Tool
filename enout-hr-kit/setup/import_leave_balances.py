#!/usr/bin/env python3
"""Carry over leave balances from Keka (or any old system) into Frappe HR.

Input CSV (export Keka's leave balance report, keep these columns):
    email,leave_type,balance
    priya.sharma@example.in,CL,7.5
    priya.sharma@example.in,AL,18
leave_type can be a short code from config (OL, CL, SL, AL) or the full Frappe name.

For each row it creates a Leave Allocation from --as-of (your go-live date) to the end of
the leave period, equal to the Keka balance. The balance then shows in Frappe and in the
employee's phone view, and Annual Leave carries forward next year by itself.

If the employee already has an allocation for that leave type this period (e.g. from the
leave policy), use --replace: it is cancelled first, but only if no leave was taken against it.

Usage:
  export FRAPPE_URL=... FRAPPE_API_KEY=... FRAPPE_API_SECRET=...      (Administrator keys)
  python setup/import_leave_balances.py --config config/enout.json --balances keka_balances.csv \\
      --as-of 2026-11-01 [--replace] [--dry-run]
"""
import argparse
import csv
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from frappe_client import Frappe, FrappeError  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", required=True)
    ap.add_argument("--balances", required=True)
    ap.add_argument("--as-of", default=str(dt.date.today()), help="go-live date (YYYY-MM-DD)")
    ap.add_argument("--replace", action="store_true", help="replace unused allocations from the leave policy")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--host-header", default=os.environ.get("FRAPPE_HOST_HEADER"))
    a = ap.parse_args()

    cfg = json.load(open(a.config))
    codes = cfg.get("leave_import", {}).get("short_codes", {})
    company = cfg["company"]["name"]
    f = Frappe(os.environ["FRAPPE_URL"], os.environ["FRAPPE_API_KEY"], os.environ["FRAPPE_API_SECRET"],
               host_header=a.host_header)

    lp = f.get_list("Leave Period", {"company": company, "is_active": 1, "from_date": ["<=", a.as_of],
                                     "to_date": [">=", a.as_of]}, ["name", "from_date", "to_date"])
    if not lp:
        sys.exit(f"No active Leave Period covering {a.as_of}. Run setup first.")
    period_end = str(lp[0]["to_date"])
    period_start = str(lp[0]["from_date"])
    types = {t["name"] for t in f.get_list("Leave Type")}
    emps = {e["company_email"].lower(): e["name"] for e in
            f.get_list("Employee", {"status": "Active"}, ["name", "company_email"]) if e.get("company_email")}
    emps.update({e["user_id"].lower(): e["name"] for e in
                 f.get_list("Employee", {"status": "Active"}, ["name", "user_id"]) if e.get("user_id")})

    rows = list(csv.DictReader(open(a.balances)))
    print(f"{len(rows)} rows · leave period {period_start} → {period_end} · as of {a.as_of}"
          f"{' · DRY RUN' if a.dry_run else ''}\n")
    done = skipped = errors = 0
    for i, r in enumerate(rows, 2):
        email = r["email"].strip().lower()
        lt = codes.get(r["leave_type"].strip(), r["leave_type"].strip())
        try:
            bal = float(r["balance"])
        except ValueError:
            print(f"line {i}: bad balance {r['balance']!r}")
            errors += 1
            continue
        emp = emps.get(email)
        if not emp or lt not in types:
            print(f"line {i}: {'unknown employee ' + email if not emp else 'unknown leave type ' + lt}")
            errors += 1
            continue
        existing = f.get_list("Leave Allocation", {"employee": emp, "leave_type": lt, "docstatus": 1,
                                                   "to_date": [">=", a.as_of], "from_date": ["<=", period_end]},
                              ["name", "from_date", "description"])
        if any("imported" in (x.get("description") or "").lower() for x in existing):
            skipped += 1
            continue  # already imported earlier: re-running is safe
        if not existing and bal <= 0:
            skipped += 1
            continue  # nothing to create for a zero balance
        if existing and not a.replace:
            print(f"line {i}: {email} already has {lt} allocation {existing[0]['name']} (use --replace)")
            skipped += 1
            continue
        if existing:
            used = f.get_list("Leave Application", {"employee": emp, "leave_type": lt, "docstatus": 1,
                                                    "from_date": [">=", period_start]}, ["name"])
            if used:
                print(f"line {i}: {email} already took {lt} in Frappe ({len(used)} applications); fix by hand")
                errors += 1
                continue
        if a.dry_run:
            print(f"would set {email:35s} {lt:18s} = {bal:g}")
            done += 1
            continue
        try:
            for x in existing:
                f.cancel("Leave Allocation", x["name"])
            if bal > 0:
                f.insert({"doctype": "Leave Allocation", "employee": emp, "leave_type": lt, "from_date": a.as_of,
                          "to_date": period_end, "new_leaves_allocated": bal, "leave_period": lp[0]["name"],
                          "description": f"Opening balance imported from Keka on {dt.date.today()}",
                          "docstatus": 1})
            done += 1
        except FrappeError as e:
            print(f"line {i}: {email} {lt}: {e.message[:150]}")
            errors += 1
    print(f"\nimported {done}, skipped {skipped}, errors {errors}")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
