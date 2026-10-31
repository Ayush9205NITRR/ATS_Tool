"""Enout HR load test (Locust).

Default = READ-ONLY, safe on the production site before launch:
  employees: home, leave balance, attendance calendar, leave list, holidays
  HR:        employee list, attendance list, leave applications
Set LOAD_WRITE=1 to add GPS check-ins and eSSL punch bursts. That creates records,
so only use it on a staging copy of the site.

Logins come from output/initial_passwords.csv (written by setup), eSSL key from output/essl_api.json.

  pip install locust
  FRAPPE_URL=https://hr.example.in locust -f tests/load_test.py --headless -u 100 -r 10 -t 3m \\
      --reset-stats --host $FRAPPE_URL --csv tests/output/load --html tests/output/load.html

Pass: p95 < 1 s and failures < 0.5% at your expected peak (see GO_LIVE.md).
"""
import csv
import datetime as dt
import itertools
import json
import os
import random

from locust import HttpUser, between, constant, task

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "output")
HOST_HEADER = os.environ.get("FRAPPE_HOST_HEADER")
WRITE = os.environ.get("LOAD_WRITE") == "1"
LOGINS = list(csv.DictReader(open(os.path.join(OUT, "initial_passwords.csv"))))
EMPLOYEES = [r for r in LOGINS if r["role"] in ("Employee", "Manager")] or LOGINS
HR = [r for r in LOGINS if r["role"] in ("HR", "Admin")] or LOGINS[:1]
_emp_iter, _hr_iter = itertools.cycle(EMPLOYEES), itertools.cycle(HR)
_seq = itertools.count()
TODAY = dt.date.today()
MONTH_START = TODAY.replace(day=1)


class _Base(HttpUser):
    abstract = True

    def login(self, row):
        if HOST_HEADER:
            self.client.headers["Host"] = HOST_HEADER
        self.client.post("/api/method/login", json={"usr": row["email"], "pwd": row["temporary_password"]}, name="login")


class Employee(_Base):
    weight = 9
    wait_time = between(1, 3)

    def on_start(self):
        self.login(next(_emp_iter))
        r = self.client.get("/api/method/hrms.api.get_current_employee_info", name="home: employee info")
        self.employee = (r.json().get("message") or {}).get("name") if r.ok else None

    @task(3)
    def home(self):
        self.client.get("/api/method/hrms.api.get_current_employee_info", name="home: employee info")

    @task(3)
    def leave_balance(self):
        self.client.get("/api/method/hrms.api.get_leave_balance_map", name="leave balance")

    @task(2)
    def calendar(self):
        self.client.get("/api/method/hrms.api.get_attendance_calendar_events",
                        params={"from_date": str(MONTH_START), "to_date": str(TODAY)}, name="attendance calendar")

    @task(2)
    def leaves(self):
        if self.employee:
            self.client.get("/api/method/hrms.api.get_leave_applications", params={"employee": self.employee},
                            name="my leave applications")

    @task(1)
    def holidays(self):
        if self.employee:
            self.client.get("/api/method/hrms.api.get_holidays_for_employee", params={"employee": self.employee},
                            name="holidays")

    @task(1)
    def gps_checkin(self):
        if WRITE and self.employee:
            self.client.post("/api/resource/Employee Checkin",
                             json={"employee": self.employee, "log_type": "IN", "latitude": 19.07, "longitude": 72.87},
                             name="web GPS check-in (write)")


class HRUser(_Base):
    weight = 1
    wait_time = between(2, 5)

    def on_start(self):
        self.login(next(_hr_iter))

    @task(2)
    def employees(self):
        self.client.get("/api/resource/Employee", params={"fields": '["name","employee_name","department"]',
                                                           "limit_page_length": 100}, name="HR: employee list")

    @task(2)
    def attendance(self):
        self.client.get("/api/resource/Attendance", params={
            "fields": '["employee","status","attendance_date"]', "limit_page_length": 500,
            "filters": json.dumps([["attendance_date", ">=", str(MONTH_START)]])}, name="HR: attendance this month")

    @task(1)
    def leave_apps(self):
        self.client.get("/api/resource/Leave Application", params={
            "fields": '["employee","status","from_date"]', "limit_page_length": 100}, name="HR: leave applications")


class EsslBurst(HttpUser):
    """Office PC catching up after an outage. Only with LOAD_WRITE=1."""
    weight = 1 if WRITE else 0
    wait_time = constant(0)

    def on_start(self):
        k = json.load(open(os.path.join(OUT, "essl_api.json")))
        if HOST_HEADER:
            self.client.headers["Host"] = HOST_HEADER
        self.client.headers["Authorization"] = f"token {k['api_key']}:{k['api_secret']}"
        self.ids = [r.get("essl_user_id") for r in LOGINS if r.get("essl_user_id")]

    @task
    def punch(self):
        n = next(_seq)
        ts = dt.datetime.combine(TODAY - dt.timedelta(days=400), dt.time(9)) + dt.timedelta(seconds=n)
        self.client.post("/api/method/hrms.hr.doctype.employee_checkin.employee_checkin.add_log_based_on_employee_field",
                         json={"employee_field_value": random.choice(self.ids) if self.ids else "101",
                               "timestamp": str(ts), "device_id": "LOAD_TEST", "log_type": "IN",
                               "latitude": 19.07, "longitude": 72.87},
                         name="eSSL punch (write)")
