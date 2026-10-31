"""eSSL -> Frappe HR sync, demo version.

Makes the same calls as the official frappe/biometric-attendance-sync-tool:
  1. pull punch logs from each eSSL device (ZK protocol, TCP 4370)
  2. POST each punch to hrms...employee_checkin.add_log_based_on_employee_field
     with token auth (API key/secret of an HR User)
  3. PUT Shift Type.last_sync_of_checkin so auto-attendance knows logs are complete

There is no physical eSSL here, so step 1 uses SimulatedEsslDevice. On a real
office PC, the official tool talks to the device with pyzk instead.
"""
import datetime
import json
import random
import sys
import time

import requests

CFG = json.load(open(sys.argv[1]))
URL = CFG.get("url", "http://127.0.0.1:8000")
HEADERS = {"Authorization": f"token {CFG['api_key']}:{CFG['api_secret']}", "Accept": "application/json"}
DAY = datetime.date(2026, 10, 31)
DEVICES = [
    {"device_id": "ESSL_MAIN_GATE", "ip": "192.168.1.201"},
    {"device_id": "ESSL_FLOOR_2", "ip": "192.168.1.202"},
]
random.seed(2026)


class SimulatedEsslDevice:
    """Returns the punch log a real eSSL returns: (user_id, timestamp, punch 0=IN/1=OUT)."""

    def __init__(self, ip):
        self.ip = ip

    def get_attendance(self):
        logs = []
        if self.ip.endswith(".202"):  # floor-2 reader: a few post-lunch re-entries
            for user in range(1001, 1061):
                if random.random() < 0.3:
                    t = datetime.datetime.combine(DAY, datetime.time(13, 30)) + datetime.timedelta(minutes=random.randint(0, 40))
                    logs.append((str(user), t, 0))
        else:
            for user in range(1001, 1501):
                if random.random() < 0.05:  # ~5% absent
                    continue
                tin = datetime.datetime.combine(DAY, datetime.time(9, 0)) + datetime.timedelta(
                    minutes=random.randint(-10, 70), seconds=random.randint(0, 59))
                tout = datetime.datetime.combine(DAY, datetime.time(18, 0)) + datetime.timedelta(
                    minutes=random.randint(0, 75), seconds=random.randint(0, 59))
                logs += [(str(user), tin, 0), (str(user), tout, 1)]
        return sorted(logs, key=lambda x: x[1])


def push(device_id, user_id, ts, punch):
    r = requests.post(
        f"{URL}/api/method/hrms.hr.doctype.employee_checkin.employee_checkin.add_log_based_on_employee_field",
        headers=HEADERS,
        json={"employee_field_value": user_id, "timestamp": str(ts), "device_id": device_id,
              "log_type": "OUT" if punch == 1 else "IN", "latitude": 19.0760, "longitude": 72.8777},
        timeout=30)
    return r.status_code, r.text[:200]


def main():
    t0 = time.time()
    ok = dup = fail = 0
    last_pull = None
    for dev in DEVICES:
        logs = SimulatedEsslDevice(dev["ip"]).get_attendance()
        last_pull = datetime.datetime.combine(DAY, datetime.time(23, 59, 59))
        print(f"[{dev['device_id']} @ {dev['ip']}:4370] pulled {len(logs)} punches", flush=True)
        for i, (uid, ts, punch) in enumerate(logs, 1):
            code, msg = push(dev["device_id"], uid, ts, punch)
            if code == 200:
                ok += 1
            elif "same timestamp" in msg:
                dup += 1
            else:
                fail += 1
                print("  failed", uid, ts, code, msg)
            if i % 200 == 0:
                print(f"  pushed {i}/{len(logs)}", flush=True)
    # tell auto-attendance that logs up to the pull time are in
    r = requests.put(f"{URL}/api/resource/Shift Type/General Shift", headers=HEADERS,
                     json={"last_sync_of_checkin": str(last_pull)}, timeout=30)
    print(f"shift sync: {r.status_code}")
    print(f"done: {ok} created, {dup} duplicates skipped, {fail} failed in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
