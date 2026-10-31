"""Frappe HR load test.

Two user types:
  EmployeeUser  - an employee on the mobile app: logs in, opens home, leave
                  balance, attendance calendar, leave list, and checks in with GPS.
                  Waits 1-3 s between actions (realistic human pacing).
  EsslSyncUser  - the office sync PC pushing biometric punches, no wait time
                  (worst case: a large backlog after an internet outage).

Run (headless):
  locust -f locustfile.py --headless -u 100 -r 20 -t 60s --host http://127.0.0.1:8001
Set HR_HOST_HEADER to the Frappe site name when hitting gunicorn directly.
"""
import datetime
import itertools
import json
import os
import random

from locust import HttpUser, between, constant, task

USERS = json.load(open(os.environ.get("LOADTEST_USERS", "/home/user/frappe-hr/work/loadtest_users.json")))
API = json.load(open(os.environ.get("ESSL_API", "/home/user/frappe-hr/work/essl_api.json")))
HOST_HEADER = os.environ.get("HR_HOST_HEADER", "hrms.localhost")
_user_iter = itertools.cycle(USERS["users"])
_punch_seq = itertools.count()
BASE_DAY = datetime.datetime(2026, 11, 2, 9, 0, 0)


class EmployeeUser(HttpUser):
    weight = int(os.environ.get("EMPLOYEE_WEIGHT", "1"))
    wait_time = between(1, 3)

    def on_start(self):
        self.client.headers["Host"] = HOST_HEADER
        u = next(_user_iter)
        self.employee = u["employee"]
        self.client.post("/api/method/login", json={"usr": u["email"], "pwd": USERS["password"]}, name="login")

    @task(3)
    def home(self):
        self.client.get("/api/method/hrms.api.get_current_employee_info", name="home: employee info")

    @task(3)
    def leave_balance(self):
        self.client.get("/api/method/hrms.api.get_leave_balance_map", name="leave balance")

    @task(2)
    def attendance_calendar(self):
        self.client.get("/api/method/hrms.api.get_attendance_calendar_events",
                        params={"from_date": "2026-10-01", "to_date": "2026-10-31"}, name="attendance calendar")

    @task(2)
    def leave_list(self):
        self.client.get("/api/method/hrms.api.get_leave_applications", params={"employee": self.employee},
                        name="my leave applications")

    @task(1)
    def gps_checkin(self):
        ts = BASE_DAY + datetime.timedelta(seconds=next(_punch_seq), microseconds=random.randint(0, 999999))
        with self.client.post("/api/resource/Employee Checkin",
                              json={"employee": self.employee, "log_type": "IN", "time": str(ts),
                                    "latitude": 12.9716, "longitude": 77.5946},
                              name="mobile GPS check-in", catch_response=True) as r:
            if r.status_code != 200:
                try:
                    r.failure(f"{r.status_code}: {r.json().get('exception', '')[:150]}")
                except Exception:
                    r.failure(f"{r.status_code}")


class EsslSyncUser(HttpUser):
    weight = int(os.environ.get("ESSL_WEIGHT", "0"))
    wait_time = constant(0)

    def on_start(self):
        self.client.headers["Host"] = HOST_HEADER
        self.client.headers["Authorization"] = f"token {API['api_key']}:{API['api_secret']}"

    @task
    def punch(self):
        n = next(_punch_seq)
        ts = BASE_DAY + datetime.timedelta(days=1, seconds=n, microseconds=random.randint(0, 999999))
        self.client.post("/api/method/hrms.hr.doctype.employee_checkin.employee_checkin.add_log_based_on_employee_field",
                         json={"employee_field_value": str(1001 + n % 500), "timestamp": str(ts),
                               "device_id": "ESSL_MAIN_GATE", "log_type": "IN",
                               # required when HR Settings > Allow Geolocation Tracking is on;
                               # the official sync tool sends the device's configured lat/long
                               "latitude": 19.0760, "longitude": 72.8777},
                         name="eSSL punch (sync tool API)")
