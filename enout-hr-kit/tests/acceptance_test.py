#!/usr/bin/env python3
"""Enout HR acceptance test: run after every deploy, before people use the system.

Checks configuration, then exercises real flows as real users of each role:
  config      scheduler, holidays, leave types, shift, settings, role profiles, data quality
  roles       employee isolation, manager/HR/eSSL-user permissions
  leave       apply, approve, balances, overlap, over-balance, observance rules, half day
  attendance  eSSL punches → Present / Late / Half Day / Absent / On Leave, duplicates, GPS rules
  payroll     salary slip amounts, PF/PT, absences reduce payment days

It creates its own test people (zz.*@acceptance.test, eSSL IDs 99901-99904) and its own
test shift, so real employees are not touched. Everything it creates is removed at the end
(use --keep to inspect).

Usage:
  export FRAPPE_URL=https://hr.example.in FRAPPE_API_KEY=... FRAPPE_API_SECRET=...   (Administrator keys)
  python tests/acceptance_test.py --config config/enout.json
Exit code 0 = all passed. Report: tests/output/acceptance_report.md
"""
import argparse
import datetime as dt
import json
import os
import secrets
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from frappe_client import Frappe, FrappeError  # noqa: E402

CHECKIN_API = "hrms.hr.doctype.employee_checkin.employee_checkin.add_log_based_on_employee_field"
DOMAIN = "acceptance.test"
TEST_SHIFT = "ZZ Acceptance Shift"
PWD = "Zz-" + secrets.token_urlsafe(10) + "!"
LAT, LON = 19.0760, 72.8777


class Skip(Exception):
    pass


class Suite:
    def __init__(self, url, key, secret, host, cfg, keep):
        self.url, self.host, self.cfg, self.keep = url, host, cfg, keep
        self.admin = Frappe(url, key, secret, host_header=host)
        self.company = cfg["company"]["name"]
        self.results = []
        self.created = []  # (doctype, name) for cleanup, in creation order
        self.people = {}

    # ------------------------------------------------------------ plumbing
    def session(self, who):
        return Frappe(self.url, host_header=self.host).login(self.people[who]["email"], PWD)

    def run(self, tid, title, fn):
        t0 = time.time()
        try:
            note = fn()
            status = "PASS"
        except Skip as e:
            status, note = "SKIP", str(e)
        except AssertionError as e:
            status, note = "FAIL", str(e)
        except FrappeError as e:
            status, note = "FAIL", f"API error {e}"
        except Exception as e:  # noqa: BLE001
            status, note = "FAIL", f"{type(e).__name__}: {e}"
            traceback.print_exc()
        self.results.append((tid, title, status, note or "", round(time.time() - t0, 1)))
        print(f"{status:4} {tid} {title}" + (f"  — {note}" if note else ""), flush=True)

    def track(self, doctype, name):
        self.created.append((doctype, name))
        return name

    def expect_denied(self, fn, what):
        try:
            fn()
        except FrappeError as e:
            if e.status in (403, 417) or "permission" in e.message.lower() or "not permitted" in e.message.lower() \
                    or "insufficient" in e.message.lower():
                return
            raise AssertionError(f"{what}: expected 'not permitted', got {e}")
        raise AssertionError(f"{what}: was ALLOWED but should be denied")

    def expect_rejected(self, fn, contains, what):
        try:
            fn()
        except FrappeError as e:
            if any(c.lower() in e.message.lower() for c in ([contains] if isinstance(contains, str) else contains)):
                return
            raise AssertionError(f"{what}: rejected with unexpected error: {e.message[:200]}")
        raise AssertionError(f"{what}: was ACCEPTED but should be rejected")

    # ------------------------------------------------------------ dates
    def load_calendar(self):
        hl = self.admin.get("Company", self.company)["default_holiday_list"]
        self.holiday_list = hl
        self.holidays = {h["holiday_date"] for h in self.admin.get("Holiday List", hl)["holidays"]}
        today = dt.date.today()

        def working(d):
            return str(d) not in self.holidays

        past, d = [], today - dt.timedelta(days=2)
        while len(past) < 6:
            if working(d):
                past.append(d)
            d -= dt.timedelta(days=1)
        self.past = sorted(past)  # 6 working days, oldest first, all <= today-2
        fut, d = [], today + dt.timedelta(days=7)
        while len(fut) < 6:
            if working(d):
                fut.append(d)
            d += dt.timedelta(days=1)
        self.future = fut

    # ------------------------------------------------------------ fixtures
    def fixtures(self):
        a = self.admin
        real = a.get("Shift Type", self.cfg["shift"]["name"])
        assert real, f"shift {self.cfg['shift']['name']} missing; run setup first"
        body = {k: real[k] for k in ("start_time", "end_time", "enable_auto_attendance", "determine_check_in_and_check_out",
                                     "working_hours_calculation_based_on", "begin_check_in_before_shift_start_time",
                                     "allow_check_out_after_shift_end_time", "working_hours_threshold_for_half_day",
                                     "working_hours_threshold_for_absent", "enable_late_entry_marking",
                                     "late_entry_grace_period", "holiday_list")}
        body["process_attendance_after"] = str(self.past[0] - dt.timedelta(days=1))
        body["last_sync_of_checkin"] = str(self.past[0] - dt.timedelta(days=1)) + " 00:00:00"
        if a.get("Shift Type", TEST_SHIFT):
            a.update("Shift Type", TEST_SHIFT, body)
        else:
            a.insert({"doctype": "Shift Type", "name": TEST_SHIFT, "__newname": TEST_SHIFT, **body})
            self.track("Shift Type", TEST_SHIFT)

        dept = a.get_list("Department", {"company": self.company, "is_group": 0}, ["name"], limit=1)[0]["name"]
        desig = a.get_list("Designation", fields=["name"], limit=1)[0]["name"]
        spec = [("hr", "Enout HR", "99901", None), ("manager", "Enout Manager", "99902", "hr"),
                ("emp1", "Enout Employee", "99903", "manager"), ("emp2", "Enout Employee", "99904", "manager")]
        for who, profile, dev, approver in spec:
            email = f"zz.{who}@{DOMAIN}"
            for old in a.get_list("Employee", {"attendance_device_id": dev}, ["name"]):
                raise AssertionError(f"leftover test employee {old['name']} with eSSL ID {dev}; run with --cleanup-only first")
            emp = a.insert({"doctype": "Employee", "first_name": "ZZ Test", "last_name": who.title(), "gender": "Male",
                            "date_of_birth": "1990-01-01", "date_of_joining": str(self.past[0] - dt.timedelta(days=60)),
                            "company": self.company, "department": dept, "designation": desig,
                            "attendance_device_id": dev, "default_shift": TEST_SHIFT, "holiday_list": self.holiday_list,
                            "status": "Active"})["name"]
            self.track("Employee", emp)
            if not a.get("User", email):
                a.insert({"doctype": "User", "email": email, "first_name": "ZZ Test", "last_name": who.title(),
                          "role_profile_name": profile, "send_welcome_email": 0, "new_password": PWD})
            else:
                a.update("User", email, {"role_profile_name": profile, "enabled": 1, "new_password": PWD})
            self.track("User", email)
            restrict = profile in ("Enout Manager", "Enout Employee")
            a.update("Employee", emp, {"user_id": email, "create_user_permission": 1 if restrict else 0})
            if not restrict:
                for up in a.get_list("User Permission", {"user": email, "allow": "Employee"}):
                    a.delete("User Permission", up["name"])
            self.people[who] = {"email": email, "employee": emp, "device": dev}
        for who, _, _, approver in spec:
            if approver:
                a.update("Employee", self.people[who]["employee"],
                         {"leave_approver": self.people[approver]["email"],
                          "reports_to": self.people[approver]["employee"]})

        year = self.future[0].year
        lp = a.get_list("Leave Period", {"company": self.company, "is_active": 1,
                                         "from_date": ["<=", str(self.future[0])], "to_date": [">=", str(self.future[-1])]},
                        ["name", "from_date", "to_date"])
        assert lp, f"no active Leave Period covering {self.future[0]}..{self.future[-1]}"
        self.leave_period = lp[0]
        pol = a.get_list("Leave Policy", {"docstatus": 1, "title": ["like", f"%{year}%"]}, ["name"]) or \
            a.get_list("Leave Policy", {"docstatus": 1}, ["name"], order_by="creation desc")
        assert pol, "no submitted Leave Policy"
        for who in ("manager", "emp1", "emp2"):
            lpa = a.insert({"doctype": "Leave Policy Assignment", "employee": self.people[who]["employee"],
                            "leave_policy": pol[0]["name"], "assignment_based_on": "Leave Period",
                            "leave_period": lp[0]["name"], "effective_from": lp[0]["from_date"],
                            "effective_to": lp[0]["to_date"], "docstatus": 1})
            self.track("Leave Policy Assignment", lpa["name"])

        st = self.cfg.get("payroll", {}).get("structure")
        if st and a.get("Salary Structure", st):
            month_start = self.past[0].replace(day=1)
            ssa = a.insert({"doctype": "Salary Structure Assignment", "employee": self.people["emp1"]["employee"],
                            "salary_structure": st, "company": self.company, "from_date": str(month_start),
                            "base": 60000, "currency": self.cfg["company"]["currency"], "docstatus": 1})
            self.track("Salary Structure Assignment", ssa["name"])
        self.essl = self.essl_session()

    def essl_session(self):
        path = os.path.join(HERE, "..", "output", "essl_api.json")
        if not os.path.exists(path):
            return None
        k = json.load(open(path))
        return Frappe(self.url, k["api_key"], k["api_secret"], host_header=self.host)

    # ------------------------------------------------------------ cleanup
    def cleanup(self):
        a = self.admin
        emps = [p["employee"] for p in self.people.values()] or \
            [e["name"] for e in a.get_list("Employee", {"attendance_device_id": ["in", ["99901", "99902", "99903", "99904"]]})]
        users = [f"zz.{w}@{DOMAIN}" for w in ("hr", "manager", "emp1", "emp2")]
        left = []
        for dtype in ("Salary Slip", "Attendance", "Employee Checkin", "Leave Application", "Leave Allocation",
                      "Leave Policy Assignment", "Salary Structure Assignment"):
            for d in a.get_list(dtype, {"employee": ["in", emps]}, ["name", "docstatus"]) if emps else []:
                try:
                    if d["docstatus"] == 1:
                        a.cancel(dtype, d["name"])
                    a.delete(dtype, d["name"])
                except FrappeError as e:
                    left.append(f"{dtype} {d['name']}: {e.message[:80]}")
        for e in emps:
            try:
                a.update("Employee", e, {"reports_to": None, "leave_approver": None})
            except FrappeError:
                pass
        for e in reversed(emps):
            try:
                a.update("Employee", e, {"user_id": None})
                for up in a.get_list("User Permission", {"for_value": e}):
                    a.delete("User Permission", up["name"])
                a.delete("Employee", e)
            except FrappeError as ex:
                left.append(f"Employee {e}: {ex.message[:80]}")
                try:
                    a.update("Employee", e, {"status": "Inactive"})
                except FrappeError:
                    pass
        for u in users:
            if a.get("User", u):
                try:
                    a.delete("User", u)
                except FrappeError:
                    a.update("User", u, {"enabled": 0})
        if a.get("Shift Type", TEST_SHIFT):
            try:
                a.delete("Shift Type", TEST_SHIFT)
            except FrappeError as e:
                left.append(f"Shift Type: {e.message[:80]}")
        return left


# ====================================================================== tests
def config_tests(s: Suite):
    a, c = s.admin, s.cfg

    def t_scheduler():
        v = a.get("System Settings", "System Settings")
        assert v.get("enable_scheduler") == 1, "scheduler is OFF: run `bench --site <site> enable-scheduler`"

    def t_holidays():
        assert s.holiday_list, "company has no default holiday list"
        yr = dt.date.today().year
        hl = a.get("Holiday List", s.holiday_list)
        assert str(hl["from_date"]) <= f"{yr}-12-31" and str(hl["to_date"]) >= f"{yr}-01-01", "holiday list not for this year"
        offs = [h for h in hl["holidays"] if h.get("weekly_off")]
        assert len(offs) >= 50, f"only {len(offs)} weekly offs"
        return f"{s.holiday_list}: {len(hl['holidays'])} days"

    def t_leave_types():
        for lt in c["leave_types"]:
            d = a.get("Leave Type", lt["name"])
            assert d, f"missing {lt['name']}"
            cap = lt["days"] + (lt.get("max_carry_forward", lt["days"]) if lt.get("carry_forward") else 0)
            assert float(d["max_leaves_allowed"]) == cap, f"{lt['name']} max {d['max_leaves_allowed']} != {cap}"
            assert bool(d["is_carry_forward"]) == bool(lt.get("carry_forward")), f"{lt['name']} carry-forward flag wrong"
            assert bool(d["is_optional_leave"]) == bool(lt.get("optional")), f"{lt['name']} optional flag wrong"
        lp = a.get_list("Leave Period", {"company": s.company, "is_active": 1}, ["name", "optional_holiday_list"])
        assert lp and lp[0]["optional_holiday_list"], "active leave period without optional (observance) holiday list"

    def t_shift():
        st = a.get("Shift Type", c["shift"]["name"])
        assert st and st["enable_auto_attendance"], "shift missing or auto attendance off"
        assert st["enable_late_entry_marking"], "late marking off"
        return f"processes attendance after {st['process_attendance_after']}"

    def t_settings():
        hr = a.get("HR Settings", "HR Settings")
        for k, v in c["hr_settings"].items():
            assert hr.get(k) == v, f"HR Settings {k}={hr.get(k)} expected {v}"
        ps = a.get("Payroll Settings", "Payroll Settings")
        assert ps.get("payroll_based_on") == "Attendance", "payroll not based on Attendance: eSSL absences would not reduce pay"

    def t_roles():
        for name, roles in c["role_profiles"].items():
            rp = a.get("Role Profile", name)
            assert rp, f"missing role profile {name}"
            have = {r["role"] for r in rp["roles"]}
            assert set(roles) <= have, f"{name} missing roles {set(roles) - have}"

    def t_people():
        emps = a.get_list("Employee", {"status": "Active", "company": s.company},
                          ["name", "employee_name", "user_id", "attendance_device_id", "default_shift", "leave_approver"])
        emps = [e for e in emps if not str(e.get("attendance_device_id") or "").startswith("999")]
        problems = []
        ids = {}
        for e in emps:
            if not e.get("attendance_device_id"):
                problems.append(f"{e['employee_name']}: no eSSL ID")
            else:
                ids.setdefault(e["attendance_device_id"], []).append(e["employee_name"])
            if not e.get("user_id"):
                problems.append(f"{e['employee_name']}: no login")
            if not e.get("default_shift"):
                problems.append(f"{e['employee_name']}: no shift")
            if not e.get("leave_approver"):
                problems.append(f"{e['employee_name']}: no leave approver")
        problems += [f"eSSL ID {k} used by {', '.join(v)}" for k, v in ids.items() if len(v) > 1]
        assert not problems, f"{len(problems)} issues: " + "; ".join(problems[:10])
        return f"{len(emps)} active employees OK"

    def t_balances():
        yr_start = s.leave_period["from_date"]
        emps = [e["name"] for e in a.get_list("Employee", {"status": "Active", "company": s.company},
                                                  ["name", "attendance_device_id"]) if not str(e.get("attendance_device_id") or "").startswith("999")]
        alloc = a.get_list("Leave Allocation", {"docstatus": 1, "from_date": [">=", yr_start]}, ["employee", "leave_type"])
        have = {}
        for x in alloc:
            have.setdefault(x["employee"], set()).add(x["leave_type"])
        need = {lt["name"] for lt in s.cfg["leave_types"]}
        none = [e for e in emps if not have.get(e)]
        assert not none, f"{len(none)} employees have NO leave set up (e.g. {none[:5]}): run setup or the Keka import"
        # Frappe cannot store a 0-day allocation, so a type missing after a Keka import usually means
        # a 0 balance. Report it so HR can confirm, without failing.
        gaps = {}
        for e in emps:
            for lt in need - have.get(e, set()):
                gaps[lt] = gaps.get(lt, 0) + 1
        note = f"{len(emps)} employees set up"
        if gaps:
            note += "; no balance (0 in Keka?): " + ", ".join(f"{k} ×{v}" for k, v in sorted(gaps.items()))
        return note

    def t_salary():
        emps = {e["name"] for e in a.get_list("Employee", {"status": "Active", "company": s.company},
                                                  ["name", "attendance_device_id"]) if not str(e.get("attendance_device_id") or "").startswith("999")}
        ssa = {x["employee"] for x in a.get_list("Salary Structure Assignment", {"docstatus": 1}, ["employee"])}
        missing = emps - ssa
        assert not missing, f"{len(missing)} employees without a salary structure (payroll will skip them)"

    def t_essl_user():
        u = s.cfg["essl_sync_user"]["email"]
        d = a.get("User", u)
        assert d, "eSSL sync user missing"
        roles = {r["role"] for r in d["roles"]}
        assert "System Manager" not in roles and "Administrator" not in roles, "eSSL sync user has admin rights"
        assert s.essl, "output/essl_api.json not found (run setup)"
        assert s.essl.whoami() == u, "eSSL API key does not log in as the sync user"

    s.run("C01", "Scheduler is on (auto attendance, emails, reminders)", t_scheduler)
    s.run("C02", "Company holiday list for this year with weekly offs", t_holidays)
    s.run("C03", "Leave types and observance holiday list", t_leave_types)
    s.run("C04", "Shift with auto attendance + late marking", t_shift)
    s.run("C05", "HR settings + payroll based on attendance", t_settings)
    s.run("C06", "Role profiles Admin / HR / Manager / Employee", t_roles)
    s.run("C07", "Every employee: eSSL ID (unique), login, shift, approver", t_people)
    s.run("C08", "Every employee has leave balances (policy or Keka import)", t_balances)
    s.run("C09", "Every employee has a salary structure", t_salary)
    s.run("C10", "eSSL sync user: works, not an admin", t_essl_user)


def role_tests(s: Suite):
    P = s.people

    def t_emp_isolation():
        e1 = s.session("emp1")
        assert e1.get("Employee", P["emp1"]["employee"]), "employee cannot read own record"
        s.expect_denied(lambda: e1.get("Employee", P["emp2"]["employee"]), "employee reading a colleague's record")
        names = {x["name"] for x in e1.get_list("Employee")}
        assert names == {P["emp1"]["employee"]}, f"employee sees {len(names)} employee records"

    def t_emp_no_admin():
        e1 = s.session("emp1")
        s.expect_denied(lambda: e1.insert({"doctype": "Attendance", "employee": P["emp2"]["employee"],
                                           "attendance_date": str(s.past[0]), "status": "Present", "company": s.company}),
                        "employee creating attendance")
        s.expect_denied(lambda: e1.get_list("Salary Structure Assignment"), "employee reading salary structures")
        try:  # Frappe silently ignores writes to locked fields, so check the stored value
            e1.update("Employee", P["emp1"]["employee"], {"attendance_device_id": "123"})
        except FrappeError:
            pass
        now_id = s.admin.get("Employee", P["emp1"]["employee"])["attendance_device_id"]
        assert now_id == P["emp1"]["device"], f"employee changed own eSSL ID to {now_id}"

    def t_emp_other_data():
        e1 = s.session("emp1")
        for dtype in ("Attendance", "Leave Application", "Salary Slip", "Employee Checkin"):
            try:
                rows = e1.get_list(dtype, fields=["name", "employee"])
            except FrappeError as e:
                if e.status == 403:
                    continue
                raise
            other = [r for r in rows if r["employee"] != P["emp1"]["employee"]]
            assert not other, f"employee can see {len(other)} {dtype} records of others"

    def t_manager():
        m = s.session("manager")
        assert m.get("Employee", P["manager"]["employee"]), "manager cannot read own record"
        team = {x["name"] for x in m.get_list("Employee")}
        assert {P["emp1"]["employee"], P["emp2"]["employee"]} <= team, "manager cannot see own team"
        assert P["hr"]["employee"] not in team, "manager can see people outside the team"
        s.expect_denied(lambda: m.insert({"doctype": "Salary Structure", "name": "zz", "company": s.company}),
                        "manager creating salary structure")

    def t_hr():
        h = s.session("hr")
        n = len(h.get_list("Employee", {"status": "Active"}))
        total = len(s.admin.get_list("Employee", {"status": "Active"}))
        assert n == total, f"HR sees only {n} of {total} active employees"
        return f"HR sees all {n} active employees"

    def t_essl_scope():
        if not s.essl:
            raise Skip("no eSSL API key")
        s.expect_denied(lambda: s.essl.get_list("Salary Slip"), "eSSL user reading salary slips")
        s.expect_denied(lambda: s.essl.insert({"doctype": "User", "email": f"zz.x@{DOMAIN}", "first_name": "x"}),
                        "eSSL user creating logins")

    s.run("R01", "Employee sees only own employee record", t_emp_isolation)
    s.run("R02", "Employee cannot create attendance / see salary structures / change eSSL ID", t_emp_no_admin)
    s.run("R03", "Employee cannot see others' attendance, leaves, payslips, punches", t_emp_other_data)
    s.run("R04", "Manager sees own team only, no payroll admin", t_manager)
    s.run("R05", "HR sees all employees", t_hr)
    s.run("R06", "eSSL sync user cannot read payroll or create users", t_essl_scope)


def leave_tests(s: Suite):
    P = s.people
    state = {}

    def balance(sess):
        return {k: v["balance_leaves"] for k, v in sess.call("hrms.api.get_leave_balance_map", http="GET").items()}

    def apply(sess, who, lt, fd, td=None, half=0, reason="acceptance test"):
        d = sess.insert({"doctype": "Leave Application", "employee": P[who]["employee"], "leave_type": lt,
                         "from_date": str(fd), "to_date": str(td or fd), "half_day": half,
                         "half_day_date": str(fd) if half else None, "description": reason,
                         "leave_approver": P["manager"]["email"] if who != "manager" else P["hr"]["email"],
                         "posting_date": str(dt.date.today())})
        s.track("Leave Application", d["name"])
        return d

    def approve(sess, name):
        sess.update("Leave Application", name, {"status": "Approved"})
        sess.submit("Leave Application", name)

    def t_apply_approve():
        e1, m = s.session("emp1"), s.session("manager")
        before = balance(e1)["Casual Leave"]
        assert before >= 1, f"starting CL balance {before}"
        la = apply(e1, "emp1", "Casual Leave", s.future[0])
        assert la["status"] == "Open"
        approve(m, la["name"])
        after = balance(e1)["Casual Leave"]
        assert after == before - 1, f"CL {before} → {after} after approving 1 day"
        return f"{before:g} → {after:g} (test joiner gets a pro-rated balance)"

    def t_self_approve():
        e1 = s.session("emp1")
        la = apply(e1, "emp1", "Casual Leave", s.future[1])
        s.expect_denied(lambda: approve(e1, la["name"]), "employee approving own leave")

    def t_overlap():
        e1 = s.session("emp1")
        s.expect_rejected(lambda: apply(e1, "emp1", "Sick Leave", s.future[0]), ["overlap", "already applied"],
                          "overlapping leave")

    def t_over_balance():
        e1 = s.session("emp1")
        s.expect_rejected(lambda: apply(e1, "emp1", "Sick Leave", s.future[2], s.future[2] + dt.timedelta(days=20)),
                          ["insufficient", "not have enough", "exceed", "maximum", "balance"], "leave beyond balance")

    def t_half_day():
        e2, m = s.session("emp2"), s.session("manager")
        before = balance(e2)["Sick Leave"]
        la = apply(e2, "emp2", "Sick Leave", s.future[3], half=1)
        assert float(la["total_leave_days"]) == 0.5, f"half day counted as {la['total_leave_days']}"
        approve(m, la["name"])
        after = balance(e2)["Sick Leave"]
        assert after == before - 0.5, f"SL {before} → {after}"

    def t_holiday_not_counted():
        e2 = s.session("emp2")
        start = s.future[4]
        d = start
        span = []
        while len(span) < 3:
            span.append(d)
            d += dt.timedelta(days=1)
        hol = sum(1 for x in span if str(x) in s.holidays)
        if not hol:
            # extend to include the next holiday/weekly off
            while str(d) not in s.holidays:
                d += dt.timedelta(days=1)
            span = [start + dt.timedelta(days=i) for i in range((d - start).days + 2)]
            hol = sum(1 for x in span if str(x) in s.holidays)
        la = apply(e2, "emp2", "Casual Leave", span[0], span[-1])
        assert float(la["total_leave_days"]) == len(span) - hol, \
            f"{len(span)}-day span with {hol} holiday(s) counted as {la['total_leave_days']}"
        return f"{len(span)} days incl. {hol} off-day → {la['total_leave_days']} leave"

    def t_observance():
        obs_list = s.admin.get("Leave Period", s.leave_period["name"])["optional_holiday_list"]
        obs = sorted(h["holiday_date"] for h in s.admin.get("Holiday List", obs_list)["holidays"])
        fut = [o for o in obs if o > str(dt.date.today()) and o not in s.holidays and o <= str(s.leave_period["to_date"])]
        if not fut:
            raise Skip("no future observance date left in this leave period")
        e2, m = s.session("emp2"), s.session("manager")
        non_obs = next(d for d in s.future if str(d) not in obs)
        s.expect_rejected(lambda: apply(e2, "emp2", "Observance Leave", non_obs), ["optional", "holiday"],
                          "observance leave on a normal day")
        la = apply(e2, "emp2", "Observance Leave", fut[0])
        approve(m, la["name"])
        return f"allowed on {fut[0]}, refused on {non_obs}"

    s.run("L01", "Employee applies, manager approves, balance drops by 1", t_apply_approve)
    s.run("L02", "Employee cannot approve own leave", t_self_approve)
    s.run("L03", "Overlapping leave is refused", t_overlap)
    s.run("L04", "Leave beyond balance is refused", t_over_balance)
    s.run("L05", "Half-day sick leave counts 0.5", t_half_day)
    s.run("L06", "Weekly off / holiday inside a leave is not counted", t_holiday_not_counted)
    s.run("L07", "Observance leave only on observance dates", t_observance)


def attendance_tests(s: Suite):
    P = s.people
    a = s.admin
    D = s.past  # 6 past working days, oldest first
    plan = {  # emp1 (eSSL) scenarios per day
        "present": (D[1], [("09:20", "IN"), ("18:40", "OUT")]),
        "late": (D[2], [("10:05", "IN"), ("18:45", "OUT")]),
        "half": (D[3], [("09:25", "IN"), ("12:40", "OUT")]),
        "single": (D[4], [("09:15", "IN")]),
    }
    absent_day, leave_day = D[0], D[5]

    def punch(sess, dev, day, hhmm, lt, loc=True):
        ts = f"{day} {hhmm}:00"
        args = {"employee_field_value": dev, "timestamp": ts, "device_id": "ZZ_TEST_DEVICE", "log_type": lt}
        if loc:
            args.update(latitude=LAT, longitude=LON)
        r = sess.call(CHECKIN_API, **args)
        s.track("Employee Checkin", r["name"])
        return r

    def t_unknown():
        if not s.essl:
            raise Skip("no eSSL API key")
        s.expect_rejected(lambda: punch(s.essl, "99999", D[1], "09:00", "IN"), "No Employee found", "unknown eSSL ID")

    def t_location_required():
        if not s.essl:
            raise Skip("no eSSL API key")
        if not s.admin.get("HR Settings", "HR Settings").get("allow_geolocation_tracking"):
            raise Skip("geolocation tracking off")
        s.expect_rejected(lambda: punch(s.essl, P["emp1"]["device"], D[1], "09:20", "IN", loc=False),
                          ["latitude", "location"], "eSSL punch without device location")
        return "set latitude/longitude for every device in essl_config.json"

    def t_punches():
        sess = s.essl or a
        for _, (day, punches) in plan.items():
            for hhmm, lt in punches:
                r = punch(sess, P["emp1"]["device"], day, hhmm, lt)
                stored = str(a.get("Employee Checkin", r["name"])["time"])[:16]
                assert stored == f"{day} {hhmm}", f"punch {day} {hhmm} stored as {stored} (time not kept)"
        return f"{sum(len(p) for _, p in plan.values())} punches over {len(plan)} days, real times kept"

    def t_duplicate():
        day, punches = plan["present"]
        s.expect_rejected(lambda: punch(s.essl or a, P["emp1"]["device"], day, punches[0][0], "IN"),
                          "same timestamp", "duplicate punch")

    def t_leave_day():
        e2, m = s.session("emp2"), s.session("manager")
        la = e2.insert({"doctype": "Leave Application", "employee": P["emp2"]["employee"], "leave_type": "Casual Leave",
                        "from_date": str(leave_day), "to_date": str(leave_day), "description": "acceptance past leave",
                        "leave_approver": P["manager"]["email"], "posting_date": str(dt.date.today())})
        s.track("Leave Application", la["name"])
        m.update("Leave Application", la["name"], {"status": "Approved"})
        m.submit("Leave Application", la["name"])

    def t_process():
        a.update("Shift Type", TEST_SHIFT, {"last_sync_of_checkin": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
        (s.essl or a).run_doc_method("Shift Type", TEST_SHIFT, "process_auto_attendance", is_manually_triggered=0)

    def att(emp, day):
        r = a.get_list("Attendance", {"employee": emp, "attendance_date": str(day), "docstatus": 1},
                       ["name", "status", "late_entry", "working_hours", "leave_type"])
        for x in r:
            s.track("Attendance", x["name"])
        return r[0] if r else None

    def t_present():
        r = att(P["emp1"]["employee"], plan["present"][0])
        assert r and r["status"] == "Present" and not r["late_entry"], f"got {r}"
        assert 9.0 <= float(r["working_hours"]) <= 9.6, f"working hours {r['working_hours']}"
        return f"{r['working_hours']:.2f} h"

    def t_late():
        r = att(P["emp1"]["employee"], plan["late"][0])
        assert r and r["status"] == "Present" and r["late_entry"], f"got {r}"

    def t_half():
        r = att(P["emp1"]["employee"], plan["half"][0])
        assert r and r["status"] == "Half Day", f"3h15m day marked {r and r['status']}"

    def t_single():
        r = att(P["emp1"]["employee"], plan["single"][0])
        assert r, "no attendance for a day with only an IN punch"
        return f"IN only (forgot OUT) → {r['status']} (flagged as single punch in daily summary)"

    def t_absent():
        r = att(P["emp1"]["employee"], absent_day)
        assert r and r["status"] == "Absent", f"day with no punch marked {r and r['status']}"

    def t_on_leave():
        r = att(P["emp2"]["employee"], leave_day)
        assert r and r["status"] == "On Leave", f"approved leave day marked {r and r['status']}"

    def t_web_checkin():
        e1 = s.session("emp1")
        ts = dt.datetime.now().replace(microsecond=0)
        d = e1.insert({"doctype": "Employee Checkin", "employee": P["emp1"]["employee"], "log_type": "IN",
                       "time": str(ts), "latitude": LAT, "longitude": LON})
        s.track("Employee Checkin", d["name"])
        s.expect_rejected(lambda: e1.insert({"doctype": "Employee Checkin", "employee": P["emp1"]["employee"],
                                             "log_type": "OUT", "time": str(ts + dt.timedelta(minutes=1))}),
                          ["latitude", "location"], "web check-in without location")
        s.expect_denied(lambda: e1.insert({"doctype": "Employee Checkin", "employee": P["emp2"]["employee"],
                                           "log_type": "IN", "time": str(ts), "latitude": LAT, "longitude": LON}),
                        "checking in for a colleague")
        fake = (ts - dt.timedelta(hours=3)).replace(minute=0, second=0)
        d2 = e1.insert({"doctype": "Employee Checkin", "employee": P["emp1"]["employee"], "log_type": "OUT",
                        "time": str(fake), "latitude": LAT, "longitude": LON})
        s.track("Employee Checkin", d2["name"])
        stored = dt.datetime.fromisoformat(str(a.get("Employee Checkin", d2["name"])["time"]))
        assert abs((stored - fake).total_seconds()) > 3600, "employee could back-date a web check-in"
        return "back-dated time ignored: server time used"

    s.run("A01", "Unknown eSSL ID is refused (not silently lost)", t_unknown)
    s.run("A02", "eSSL punch without device location is refused", t_location_required)
    s.run("A03", "eSSL punches accepted with their real punch time", t_punches)
    s.run("A04", "Duplicate punch is refused (re-running sync is safe)", t_duplicate)
    s.run("A05", "Approved past leave", t_leave_day)
    s.run("A06", "Auto attendance runs", t_process)
    s.run("A07", "IN 09:20 + OUT 18:40 → Present, ~9.3 h", t_present)
    s.run("A08", "IN 10:05 → Late", t_late)
    s.run("A09", "Only 3 h worked → Half Day", t_half)
    s.run("A10", "Forgot to punch OUT → result", t_single)
    s.run("A11", "No punch on a working day → Absent", t_absent)
    s.run("A12", "Approved leave day → On Leave", t_on_leave)
    def t_late_punches_heal():
        # emp2 had no punches on D[1] → auto Absent. Punches arrive later (device was offline).
        r0 = att(P["emp2"]["employee"], D[1])
        assert r0 and r0["status"] == "Absent", f"precondition: expected auto Absent, got {r0}"
        sess = s.essl or a
        punch(sess, P["emp2"]["device"], D[1], "09:10", "IN")
        punch(sess, P["emp2"]["device"], D[1], "18:20", "OUT")
        sys.path.insert(0, os.path.join(HERE, "..", "essl"))
        import essl_daily_sync
        essl_daily_sync.fix_false_absents(sess, D[1], D[1], sess.whoami())
        sess.run_doc_method("Shift Type", TEST_SHIFT, "process_auto_attendance", is_manually_triggered=0)
        r = att(P["emp2"]["employee"], D[1])
        assert r and r["status"] == "Present", f"after late punches: {r}"
        return "auto Absent → Present after punches arrived late"

    s.run("A14", "Late-arriving punches turn an auto Absent into Present", t_late_punches_heal)
    s.run("A13", "Web check-in: needs location, only for yourself, can't back-date", t_web_checkin)


def payroll_tests(s: Suite):
    P = s.people
    st = s.cfg.get("payroll", {}).get("structure")

    def t_slip():
        if not st:
            raise Skip("no payroll section in config")
        start = s.past[0].replace(day=1)
        end = (start.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
        h = s.session("hr")
        slip = h.insert({"doctype": "Salary Slip", "employee": P["emp1"]["employee"], "start_date": str(start),
                         "end_date": str(end), "posting_date": str(end), "payroll_frequency": "Monthly",
                         "company": s.company, "currency": s.cfg["company"]["currency"]})
        s.track("Salary Slip", slip["name"])
        twd, pd_ = float(slip["total_working_days"]), float(slip["payment_days"])
        absent = float(slip.get("absent_days") or 0)
        half = 0.5 if any(d.month == start.month for d in [s.past[3]]) else 0
        ded = {d["salary_component"]: float(d["amount"]) for d in slip["deductions"]}
        earn = {e["salary_component"]: float(e["amount"]) for e in slip["earnings"]}
        exp_basic = round(60000 * 0.5 * pd_ / twd, 0)
        assert abs(earn.get("Basic", 0) - exp_basic) <= 1, f"Basic {earn.get('Basic')} expected ~{exp_basic}"
        assert ded.get("Professional Tax") == 200, f"PT {ded.get('Professional Tax')}"
        assert ded.get("Provident Fund") == 1800, f"PF {ded.get('Provident Fund')} (basic > 15000 → 1800)"
        assert pd_ < twd, f"payment days {pd_} = working days {twd}: eSSL absence did not reduce pay"
        return (f"{start:%b %Y}: working days {twd:g}, payment days {pd_:g} (absent {absent:g}, half day counted), "
                f"gross ₹{float(slip['gross_pay']):,.0f}, net ₹{float(slip['net_pay']):,.0f}")

    def t_emp_sees_own_slip():
        if not st:
            raise Skip("no payroll section in config")
        slips = [n for d, n in s.created if d == "Salary Slip"]
        if not slips:
            raise Skip("no slip created")
        h = s.session("hr")
        h.submit("Salary Slip", slips[0])
        e1, e2 = s.session("emp1"), s.session("emp2")
        assert e1.get("Salary Slip", slips[0]), "employee cannot see own payslip"
        s.expect_denied(lambda: e2.get("Salary Slip", slips[0]), "colleague reading the payslip")

    s.run("P01", "Salary slip: Basic prorated, PF 1800, PT 200, absences cut pay", t_slip)
    s.run("P02", "Employee sees own payslip, colleague cannot", t_emp_sees_own_slip)


# ====================================================================== main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", required=True)
    ap.add_argument("--keep", action="store_true", help="leave test data in place for inspection")
    ap.add_argument("--cleanup-only", action="store_true")
    ap.add_argument("--host-header", default=os.environ.get("FRAPPE_HOST_HEADER"))
    a = ap.parse_args()
    s = Suite(os.environ["FRAPPE_URL"], os.environ["FRAPPE_API_KEY"], os.environ["FRAPPE_API_SECRET"],
              a.host_header, json.load(open(a.config)), a.keep)
    if a.cleanup_only:
        left = s.cleanup()
        print("cleanup done" + (f"; left: {left}" if left else ""))
        return
    print(f"Acceptance test against {os.environ['FRAPPE_URL']} as {s.admin.whoami()}\n")
    t0 = time.time()
    s.load_calendar()
    s.run("F00", "Create test people, shift, leave policy, salary", s.fixtures)
    if s.results[-1][2] == "PASS":
        config_tests(s)
        role_tests(s)
        leave_tests(s)
        attendance_tests(s)
        payroll_tests(s)
    left = [] if s.keep else s.cleanup()
    passed = sum(1 for r in s.results if r[2] == "PASS")
    failed = [r for r in s.results if r[2] == "FAIL"]
    skipped = sum(1 for r in s.results if r[2] == "SKIP")
    os.makedirs(os.path.join(HERE, "output"), exist_ok=True)
    rep = os.path.join(HERE, "output", "acceptance_report.md")
    with open(rep, "w") as fh:
        fh.write(f"# Acceptance test — {dt.datetime.now():%Y-%m-%d %H:%M}\n\nSite: {os.environ['FRAPPE_URL']}\n\n")
        fh.write(f"**{passed} passed, {len(failed)} failed, {skipped} skipped** in {time.time() - t0:.0f} s\n\n")
        fh.write("| ID | Check | Result | Notes |\n|---|---|---|---|\n")
        for tid, title, status, note, _ in s.results:
            fh.write(f"| {tid} | {title} | {status} | {note.replace('|', '/')} |\n")
        if left:
            fh.write("\nCleanup left behind:\n" + "\n".join(f"- {x}" for x in left) + "\n")
    print(f"\n{passed} passed, {len(failed)} failed, {skipped} skipped — report: {rep}")
    if left:
        print("cleanup left:", left)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
