#!/usr/bin/env python3
"""Enout HR one-command setup (safe to re-run).

Configures a Frappe HR v15 site over its REST API:
  - (optional) setup wizard: company, India, INR, fiscal year
  - departments, designations, holiday lists (incl. observance list)
  - leave types, leave period, leave policy
  - shift with auto attendance, HR settings
  - role profiles: Enout Admin / HR / Manager / Employee
  - employees + logins from a CSV, manager = leave approver
  - leave policy assignment for every employee (creates leave balances)
  - API user for the eSSL sync (keys written to output/essl_api.json)

Usage:
  export FRAPPE_URL=https://hr.example.in FRAPPE_API_KEY=... FRAPPE_API_SECRET=...
  python setup/enout_setup.py --config config/enout.json --employees config/employees.csv [--run-wizard]
"""
import argparse
import csv
import datetime as dt
import json
import os
import secrets
import string
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from frappe_client import Frappe, FrappeError  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "output")
WEEKDAY = {d: i for i, d in enumerate(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])}


def log(msg):
    print(f"  {msg}", flush=True)


def step(msg):
    print(f"\n== {msg}", flush=True)


def temp_password():
    alphabet = string.ascii_letters + string.digits
    return "Enout-" + "".join(secrets.choice(alphabet) for _ in range(10)) + "!"


class Setup:
    def __init__(self, fr: Frappe, cfg: dict):
        self.f = fr
        self.c = cfg
        self.company = cfg["company"]["name"]
        self.abbr = cfg["company"]["abbr"]
        self.year = cfg["year"]
        self.hl_name = f"{self.company} {self.year}"
        self.obs_name = f"{self.company} Observance {self.year}"

    # ------------------------------------------------------------ wizard
    def wizard(self):
        step("Setup wizard")
        if self.f.get("Company", self.company):
            log(f"company '{self.company}' already exists, skipping")
            return
        c = self.c["company"]
        self.f.call("frappe.desk.page.setup_wizard.setup_wizard.setup_complete", args=json.dumps({
            "language": "English", "country": c["country"], "timezone": c["timezone"], "currency": c["currency"],
            "full_name": c["admin_full_name"], "email": c["admin_email"], "company_name": self.company,
            "company_abbr": self.abbr, "chart_of_accounts": "Standard", "fy_start_date": c["fy_start_date"],
            "fy_end_date": c["fy_end_date"], "setup_demo": 0}))
        log("company created")

    def check_company(self):
        if not self.f.get("Company", self.company):
            sys.exit(f"Company '{self.company}' not found. Finish the setup wizard first, or pass --run-wizard.")

    # ------------------------------------------------------------ masters
    def departments(self, names):
        step("Departments & designations")
        for d in sorted(names["departments"]):
            if not self.f.exists("Department", {"department_name": d, "company": self.company}):
                self.f.insert({"doctype": "Department", "department_name": d, "company": self.company,
                               "parent_department": "All Departments"})
                log(f"+ department {d}")
        for d in sorted(names["designations"]):
            if not self.f.get("Designation", d):
                self.f.insert({"doctype": "Designation", "designation_name": d})
                log(f"+ designation {d}")

    def holiday_lists(self):
        step("Holiday lists")
        y = self.year
        start, end = dt.date(y, 1, 1), dt.date(y, 12, 31)
        offs = [WEEKDAY[w] for w in self.c["weekly_off"]]
        rows = {}
        d = start
        while d <= end:
            if d.weekday() in offs:
                rows[str(d)] = {"holiday_date": str(d), "description": d.strftime("%A"), "weekly_off": 1}
            d += dt.timedelta(days=1)
        for h in self.c["holidays"]:
            rows[h["date"]] = {"holiday_date": h["date"], "description": h["name"], "weekly_off": 0}
        self._upsert_holiday_list(self.hl_name, start, end, sorted(rows.values(), key=lambda r: r["holiday_date"]))
        obs = [{"holiday_date": h["date"], "description": h["name"]} for h in self.c["observance_holidays"]]
        self._upsert_holiday_list(self.obs_name, start, end, obs)
        self.f.update("Company", self.company, {"default_holiday_list": self.hl_name})
        log(f"company default holiday list = {self.hl_name}")

    def _upsert_holiday_list(self, name, start, end, rows):
        body = {"holiday_list_name": name, "from_date": str(start), "to_date": str(end), "holidays": rows}
        if self.f.get("Holiday List", name):
            self.f.update("Holiday List", name, body)
            log(f"~ updated {name} ({len(rows)} days)")
        else:
            self.f.insert({"doctype": "Holiday List", **body})
            log(f"+ {name} ({len(rows)} days)")

    def leave_types(self):
        step("Leave types")
        for lt in self.c["leave_types"]:
            body = {"leave_type_name": lt["name"], "max_leaves_allowed": lt["days"], "include_holiday": 0,
                    "allow_negative": 0, "is_carry_forward": 1 if lt.get("carry_forward") else 0,
                    "is_optional_leave": 1 if lt.get("optional") else 0, "is_lwp": 0}
            if self.f.get("Leave Type", lt["name"]):
                self.f.update("Leave Type", lt["name"], body)
                log(f"~ {lt['name']} ({lt['days']} days)")
            else:
                self.f.insert({"doctype": "Leave Type", **body})
                log(f"+ {lt['name']} ({lt['days']} days)")

    def leave_period_and_policy(self):
        step("Leave period & policy")
        y = self.year
        lp = self.f.get_list("Leave Period", {"from_date": f"{y}-01-01", "company": self.company}, ["name"])
        body = {"from_date": f"{y}-01-01", "to_date": f"{y}-12-31", "company": self.company, "is_active": 1,
                "optional_holiday_list": self.obs_name}
        if lp:
            self.f.update("Leave Period", lp[0]["name"], body)
            self.leave_period = lp[0]["name"]
            log(f"~ leave period {self.leave_period}")
        else:
            self.leave_period = self.f.insert({"doctype": "Leave Period", **body})["name"]
            log(f"+ leave period {self.leave_period}")
        self.policy = f"Enout Leave Policy {y}"
        existing = self.f.get_list("Leave Policy", {"title": self.policy, "docstatus": 1}, ["name"])
        if existing:
            self.policy = existing[0]["name"]
            log(f"= policy {self.policy} already submitted (to change days: cancel it in Frappe and re-run)")
            return
        doc = self.f.insert({"doctype": "Leave Policy", "title": self.policy, "docstatus": 1,
                             "leave_policy_details": [{"leave_type": lt["name"], "annual_allocation": lt["days"]}
                                                      for lt in self.c["leave_types"]]})
        self.policy = doc["name"]
        log(f"+ policy {self.policy}")

    def shift(self):
        step("Shift with auto attendance")
        s = self.c["shift"]
        body = {"start_time": s["start"], "end_time": s["end"], "enable_auto_attendance": 1,
                "determine_check_in_and_check_out": "Alternating entries as IN and OUT during the same shift",
                "working_hours_calculation_based_on": "First Check-in and Last Check-out",
                "begin_check_in_before_shift_start_time": s["early_checkin_minutes"],
                "allow_check_out_after_shift_end_time": s["late_checkout_minutes"],
                "working_hours_threshold_for_half_day": s["half_day_below_hours"],
                "working_hours_threshold_for_absent": s["absent_below_hours"],
                "enable_late_entry_marking": 1, "late_entry_grace_period": s["late_grace_minutes"],
                "process_attendance_after": s["process_attendance_after"], "holiday_list": self.hl_name,
                "mark_auto_attendance_on_holidays": 0}
        if self.f.get("Shift Type", s["name"]):
            self.f.update("Shift Type", s["name"], body)
            log(f"~ {s['name']}")
        else:
            self.f.insert({"doctype": "Shift Type", "name": s["name"], "__newname": s["name"], **body})
            log(f"+ {s['name']}")

    def hr_settings(self):
        step("HR settings")
        self.f.update("HR Settings", "HR Settings", self.c["hr_settings"])
        log(", ".join(f"{k}={v}" for k, v in self.c["hr_settings"].items()))

    def payroll_settings(self):
        step("Payroll settings (eSSL absences reduce pay)")
        ps = self.c.get("payroll_settings")
        if ps:
            self.f.update("Payroll Settings", "Payroll Settings", ps)
            log(", ".join(f"{k}={v}" for k, v in ps.items()))

    def role_profiles(self):
        step("Role profiles")
        for name, roles in self.c["role_profiles"].items():
            body = {"role_profile": name, "roles": [{"role": r} for r in roles]}
            if self.f.get("Role Profile", name):
                self.f.update("Role Profile", name, body)
                log(f"~ {name}: {', '.join(roles)}")
            else:
                self.f.insert({"doctype": "Role Profile", **body})
                log(f"+ {name}: {', '.join(roles)}")

    # ------------------------------------------------------------ people
    def people(self, rows, send_welcome):
        step(f"Employees & logins ({len(rows)} rows)")
        role_map = self.c["csv_role_to_profile"]
        emp_by_email = {}
        new_passwords = []
        for r in rows:
            email = r["email"].strip().lower()
            dev = r["essl_user_id"].strip()
            emp = self.f.get_list("Employee", {"attendance_device_id": dev}, ["name", "user_id"]) or \
                self.f.get_list("Employee", {"company_email": email}, ["name", "user_id"])
            body = {"first_name": r["first_name"].strip(), "last_name": r["last_name"].strip(),
                    "gender": r["gender"].strip(), "date_of_birth": r["date_of_birth"].strip(),
                    "date_of_joining": r["date_of_joining"].strip(), "company": self.company,
                    "department": f"{r['department'].strip()} - {self.abbr}", "designation": r["designation"].strip(),
                    "attendance_device_id": dev, "default_shift": self.c["shift"]["name"],
                    "holiday_list": self.hl_name, "company_email": email, "prefered_contact_email": "Company Email",
                    "cell_number": r.get("mobile", "").strip(), "status": "Active"}
            if emp:
                name = emp[0]["name"]
                self.f.update("Employee", name, body)
                log(f"~ employee {name} {email} (eSSL {dev})")
            else:
                name = self.f.insert({"doctype": "Employee", **body})["name"]
                log(f"+ employee {name} {email} (eSSL {dev})")
            emp_by_email[email] = name

            profile = role_map[r["role"].strip()]
            if not self.f.get("User", email):
                u = {"doctype": "User", "email": email, "first_name": body["first_name"], "last_name": body["last_name"],
                     "role_profile_name": profile, "send_welcome_email": 1 if send_welcome else 0,
                     "mobile_no": body["cell_number"]}
                if not send_welcome:
                    pwd = temp_password()
                    u["new_password"] = pwd
                    new_passwords.append({"email": email, "temporary_password": pwd, "role": r["role"]})
                self.f.insert(u)
                log(f"+ login {email} [{profile}]")
            else:
                self.f.update("User", email, {"role_profile_name": profile, "enabled": 1})
                log(f"~ login {email} [{profile}]")
            restrict = r["role"].strip() in self.c.get("restrict_to_own_record", ["Manager", "Employee"])
            self.f.update("Employee", name, {"user_id": email, "create_user_permission": 1 if restrict else 0})
            if not restrict:  # HR/Admin must see everyone: drop any own-record restriction
                for up in self.f.get_list("User Permission", {"user": email, "allow": "Employee"}):
                    self.f.delete("User Permission", up["name"])

        step("Managers & leave approvers")
        hr = [r["email"].strip().lower() for r in rows if r["role"].strip() == "HR"]
        admins = [r["email"].strip().lower() for r in rows if r["role"].strip() == "Admin"]
        for r in rows:
            email = r["email"].strip().lower()
            mgr = r.get("reports_to_email", "").strip().lower()
            vals = {}
            if mgr and mgr in emp_by_email and mgr != email:
                vals = {"reports_to": emp_by_email[mgr], "leave_approver": mgr}
            else:
                if mgr:
                    log(f"! {email}: manager {mgr} not in CSV")
                # no manager: HR approves; HR's own leave goes to an Admin; an Admin's to HR
                chain = ([h for h in hr if h != email] if r["role"].strip() != "HR" else []) + \
                        [a for a in admins if a != email] + [h for h in hr if h != email]
                if chain:
                    vals = {"leave_approver": chain[0]}
            if vals:
                self.f.update("Employee", emp_by_email[email], vals)
                log(f"{email} → approver {vals['leave_approver']}")
            else:
                log(f"! {email}: NO leave approver. Add reports_to_email or an Admin/HR row to the CSV")

        if new_passwords:
            os.makedirs(OUT, exist_ok=True)
            p = os.path.join(OUT, "initial_passwords.csv")
            with open(p, "w", newline="") as fh:
                w = csv.DictWriter(fh, fieldnames=["email", "temporary_password", "role"])
                w.writeheader()
                w.writerows(new_passwords)
            os.chmod(p, 0o600)
            log(f"temporary passwords for {len(new_passwords)} new logins → {p}  (share privately, then delete)")
        return emp_by_email

    def assign_leave_policy(self, emp_names):
        step("Leave policy assignment (creates leave balances)")
        for name in emp_names:
            if self.f.exists("Leave Policy Assignment", {"employee": name, "leave_period": self.leave_period, "docstatus": 1}):
                continue
            self.f.insert({"doctype": "Leave Policy Assignment", "employee": name, "leave_policy": self.policy,
                           "assignment_based_on": "Leave Period", "leave_period": self.leave_period,
                           "effective_from": f"{self.year}-01-01", "effective_to": f"{self.year}-12-31",
                           "docstatus": 1})
            log(f"+ {name}")

    def payroll(self, rows, emp_by_email):
        step("Payroll: salary structure & assignments")
        pc = self.c.get("payroll")
        if not pc:
            log("no 'payroll' section in config, skipped")
            return
        for c in pc["earnings"] + pc["deductions"]:
            typ = "Earning" if c in pc["earnings"] else "Deduction"
            body = {"salary_component": c["component"], "salary_component_abbr": c["abbr"], "type": typ,
                    "depends_on_payment_days": 0 if c.get("fixed") else 1}
            if self.f.get("Salary Component", c["component"]):
                self.f.update("Salary Component", c["component"], {"depends_on_payment_days": body["depends_on_payment_days"]})
            else:
                self.f.insert({"doctype": "Salary Component", **body})
                log(f"+ component {c['component']} ({c['abbr']})")

        def row(c):
            if "formula" in c:
                return {"salary_component": c["component"], "abbreviation": c["abbr"],
                        "amount_based_on_formula": 1, "formula": c["formula"]}
            return {"salary_component": c["component"], "abbreviation": c["abbr"], "amount": c["amount"]}

        name = pc["structure"]
        existing = self.f.get("Salary Structure", name)
        if existing and existing["docstatus"] == 1:
            log(f"= {name} already submitted (to change formulas: cancel + amend in Frappe)")
        else:
            body = {"company": self.company, "payroll_frequency": "Monthly", "currency": self.c["company"]["currency"],
                    "is_active": "Yes", "earnings": [row(c) for c in pc["earnings"]],
                    "deductions": [row(c) for c in pc["deductions"]]}
            if existing:
                self.f.update("Salary Structure", name, body)
            else:
                self.f.insert({"doctype": "Salary Structure", "name": name, "__newname": name, **body})
            self.f.submit("Salary Structure", name)
            log(f"+ {name} submitted")

        payable = self.f.get("Company", self.company).get("default_payroll_payable_account")
        n = 0
        for r in rows:
            ctc = (r.get("monthly_ctc") or "").strip()
            if not ctc:
                continue
            emp = emp_by_email[r["email"].strip().lower()]
            if self.f.exists("Salary Structure Assignment", {"employee": emp, "docstatus": 1}):
                continue
            self.f.insert({"doctype": "Salary Structure Assignment", "employee": emp, "salary_structure": name,
                           "company": self.company, "from_date": pc["from_date"], "base": float(ctc),
                           "currency": self.c["company"]["currency"], "payroll_payable_account": payable,
                           "docstatus": 1})
            n += 1
        log(f"+ {n} salary structure assignments (employees with monthly_ctc in the CSV)")

    def _grant(self, doctype, role, level, ptypes):
        self.f.call("frappe.core.page.permission_manager.permission_manager.add", parent=doctype, role=role, permlevel=level)
        for pt in ptypes:
            self.f.call("frappe.core.page.permission_manager.permission_manager.update",
                        doctype=doctype, role=role, permlevel=level, ptype=pt, value=1)

    def lock_employee_fields(self):
        step("Lock sensitive employee fields (eSSL ID, shift, approver, ...)")
        lk = self.c.get("locked_employee_fields")
        if not lk:
            return
        for fld in lk["fields"]:
            name = f"Employee-{fld}-permlevel"
            body = {"doctype_or_field": "DocField", "doc_type": "Employee", "field_name": fld,
                    "property": "permlevel", "property_type": "Int", "value": "1"}
            if self.f.get("Property Setter", name):
                self.f.update("Property Setter", name, body)
            else:
                self.f.insert({"doctype": "Property Setter", **body})
        for role in lk["write_roles"]:
            self._grant("Employee", role, 1, ["read", "write"])
        for role in lk["read_roles"]:
            if self.f.get("Role", role):
                self._grant("Employee", role, 1, ["read"])
        log(f"{len(lk['fields'])} fields: write {', '.join(lk['write_roles'])}; read-only {', '.join(lk['read_roles'])}")

    def essl_role(self):
        step("eSSL Sync role (least privilege)")
        u = self.c["essl_sync_user"]
        if not self.f.get("Role", u["role"]):
            self.f.insert({"doctype": "Role", "role_name": u["role"], "desk_access": 1})
            log(f"+ role {u['role']}")
        for key, ptypes in u["permissions"].items():
            doctype, _, level = key.partition("@")
            self._grant(doctype, u["role"], int(level or 0), ptypes)
            log(f"{u['role']}: {doctype}{' (level ' + level + ')' if level else ''} {'/'.join(ptypes)}")

    def essl_user(self):
        step("eSSL sync API user")
        u = self.c["essl_sync_user"]
        if not self.f.get("User", u["email"]):
            self.f.insert({"doctype": "User", "email": u["email"], "first_name": "eSSL", "last_name": "Sync",
                           "send_welcome_email": 0, "roles": [{"role": u["role"]}]})
            log(f"+ {u['email']} ({u['role']})")
        else:  # enforce exactly the sync role
            self.f.update("User", u["email"], {"roles": [{"role": u["role"]}], "role_profile_name": None})
            log(f"~ {u['email']} roles = {u['role']} only")
        os.makedirs(OUT, exist_ok=True)
        p = os.path.join(OUT, "essl_api.json")
        if os.path.exists(p):
            log(f"= keys already in {p} (delete the file to rotate keys)")
            return
        secret = self.f.call("frappe.core.doctype.user.user.generate_keys", user=u["email"])["api_secret"]
        key = self.f.get("User", u["email"])["api_key"]
        with open(p, "w") as fh:
            json.dump({"api_key": key, "api_secret": secret}, fh)
        os.chmod(p, 0o600)
        log(f"API key/secret → {p}  (copy into the eSSL sync config on the office PC)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", required=True)
    ap.add_argument("--employees", help="CSV of employees (see config/employees.sample.csv)")
    ap.add_argument("--run-wizard", action="store_true", help="complete the setup wizard if the company is missing")
    ap.add_argument("--send-welcome", action="store_true", help="email login links (needs an Email Account in Frappe)")
    ap.add_argument("--host-header", default=os.environ.get("FRAPPE_HOST_HEADER"))
    a = ap.parse_args()

    fr = Frappe(os.environ["FRAPPE_URL"], os.environ["FRAPPE_API_KEY"], os.environ["FRAPPE_API_SECRET"],
                host_header=a.host_header)
    cfg = json.load(open(a.config))
    print(f"Connected to {os.environ['FRAPPE_URL']} as {fr.whoami()}")
    s = Setup(fr, cfg)
    rows = list(csv.DictReader(open(a.employees))) if a.employees else []
    try:
        if a.run_wizard:
            s.wizard()
        s.check_company()
        s.departments({"departments": {r["department"].strip() for r in rows},
                       "designations": {r["designation"].strip() for r in rows}})
        s.holiday_lists()
        s.leave_types()
        s.leave_period_and_policy()
        s.shift()
        s.hr_settings()
        s.payroll_settings()
        s.role_profiles()
        s.essl_role()
        s.lock_employee_fields()
        if rows:
            emps = s.people(rows, a.send_welcome)
            s.assign_leave_policy(emps.values())
            s.payroll(rows, emps)
        s.essl_user()
    except FrappeError as e:
        sys.exit(f"\nFAILED: {e}")
    print("\nSetup complete.")


if __name__ == "__main__":
    main()
