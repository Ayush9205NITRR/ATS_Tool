#!/usr/bin/env python3
"""eSSL → Frappe HR sync, run once a day or on demand.

No need to keep it running. Each run:
  1. reads every punch stored on each eSSL device (ZK protocol, TCP 4370)
  2. keeps punches from the days not yet synced (catch-up after missed days)
  3. pushes them to Frappe HR as Employee Checkins (duplicates are skipped safely)
  4. updates the shift's "last sync" time and runs Auto Attendance
     → Present / Late / Half Day / Absent appear for those days
  5. writes a daily summary (present, late, absent, single-punch) to logs/

Usage (on the always-on office PC):
  python essl_daily_sync.py                       # catch up from last run to today
  python essl_daily_sync.py --date 2026-11-02     # one day
  python essl_daily_sync.py --from 2026-11-01 --to 2026-11-30   # backfill
  python essl_daily_sync.py --test                # can we reach each device?
  python essl_daily_sync.py --check-mapping       # device users vs Frappe employees
  python essl_daily_sync.py --enroll [--yes]      # add missing employees onto devices
  python essl_daily_sync.py --dry-run             # read devices, push nothing

Exit code: 0 ok, 1 some punches failed, 2 a device or Frappe was unreachable.
"""
import argparse
import concurrent.futures as cf
import csv
import datetime as dt
import json
import logging
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from frappe_client import Frappe, FrappeError  # noqa: E402

CHECKIN_API = "hrms.hr.doctype.employee_checkin.employee_checkin.add_log_based_on_employee_field"
DUPLICATE = "already has a log with the same timestamp"
NO_EMPLOYEE = "No Employee found"
INACTIVE = "Inactive Employee"
log = logging.getLogger("essl")


# ------------------------------------------------------------------ devices
class Punch:
    __slots__ = ("user_id", "timestamp", "punch")

    def __init__(self, user_id, timestamp, punch):
        self.user_id, self.timestamp, self.punch = str(user_id), timestamp, punch


class EsslDevice:
    """Real eSSL/ZKTeco device via pyzk."""

    def __init__(self, cfg):
        self.cfg = cfg

    def _connect(self):
        from zk import ZK  # pip install pyzk
        zk = ZK(self.cfg["ip"], port=self.cfg.get("port", 4370), timeout=self.cfg.get("timeout", 30),
                password=self.cfg.get("password", 0), force_udp=self.cfg.get("udp", False), ommit_ping=True)
        return zk.connect()

    def read(self):
        conn = self._connect()
        try:
            conn.disable_device()  # freeze the log while reading
            users = {u.user_id: u.name for u in conn.get_users()}
            punches = [Punch(a.user_id, a.timestamp, a.punch) for a in conn.get_attendance()]
            info = {"serial": _safe(conn.get_serialnumber), "time": str(_safe(conn.get_time)),
                    "firmware": _safe(conn.get_firmware_version)}
        finally:
            try:
                conn.enable_device()
            finally:
                conn.disconnect()
        return users, punches, info

    def add_users(self, employees):
        conn = self._connect()
        try:
            conn.disable_device()
            existing = conn.get_users()
            next_uid = max([u.uid for u in existing] + [0]) + 1
            for e in employees:
                conn.set_user(uid=next_uid, name=e["employee_name"][:24], privilege=0, password="",
                              group_id="", user_id=str(e["attendance_device_id"]))
                next_uid += 1
        finally:
            try:
                conn.enable_device()
            finally:
                conn.disconnect()


class SimulatedDevice:
    """For testing without hardware: 95% attendance, IN 08:50-10:15, OUT 17:55-19:20,
    3% forget to punch out. Deterministic per (device, day)."""

    def __init__(self, cfg, user_ids, days):
        self.cfg, self.user_ids, self.days = cfg, user_ids, days

    def read(self):
        punches = []
        for day in self.days:
            rnd = random.Random(f"{self.cfg['device_id']}-{day}")
            if day.weekday() == 6:
                continue
            for u in self.user_ids:
                if rnd.random() < 0.05:
                    continue
                tin = dt.datetime.combine(day, dt.time(8, 50)) + dt.timedelta(minutes=rnd.randint(0, 85), seconds=rnd.randint(0, 59))
                punches.append(Punch(u, tin, 0))
                if rnd.random() > 0.03:
                    tout = dt.datetime.combine(day, dt.time(17, 55)) + dt.timedelta(minutes=rnd.randint(0, 85), seconds=rnd.randint(0, 59))
                    punches.append(Punch(u, tout, 1))
        return {u: f"User {u}" for u in self.user_ids}, sorted(punches, key=lambda p: p.timestamp), {"serial": "SIMULATED"}

    def add_users(self, employees):
        log.info("simulated device: would add %d users", len(employees))


def _safe(fn):
    try:
        return fn()
    except Exception:
        return None


# ------------------------------------------------------------------ helpers
def load_config(path):
    cfg = json.load(open(path))
    base = os.path.dirname(os.path.abspath(path))
    if cfg.get("api_file"):
        api = json.load(open(os.path.join(base, cfg["api_file"])))
        cfg["api_key"], cfg["api_secret"] = api["api_key"], api["api_secret"]
    for k in ("state_file", "log_dir"):
        cfg[k] = os.path.join(base, cfg.get(k, "state.json" if k == "state_file" else "logs"))
    return cfg


def load_state(cfg):
    try:
        return json.load(open(cfg["state_file"]))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(cfg, state):
    tmp = cfg["state_file"] + ".tmp"
    json.dump(state, open(tmp, "w"), indent=2)
    os.replace(tmp, cfg["state_file"])


def log_type(dev_cfg, code, cfg):
    mode = dev_cfg.get("punch_direction", "AUTO")
    if mode in ("IN", "OUT"):
        return mode
    if mode == "AUTO":
        if code in cfg.get("punch_in_codes", [0, 4]):
            return "IN"
        if code in cfg.get("punch_out_codes", [1, 5]):
            return "OUT"
    return None  # let the shift's alternating IN/OUT rule decide


def date_range(a, b):
    d = a
    while d <= b:
        yield d
        d += dt.timedelta(days=1)


# ------------------------------------------------------------------ main steps
def make_devices(cfg, args, fr):
    if not args.simulate:
        return [(d, EsslDevice(d)) for d in cfg["devices"]]
    ids = [e["attendance_device_id"] for e in fr.get_list(
        "Employee", {"status": "Active", "attendance_device_id": ["is", "set"]}, ["attendance_device_id"])]
    if args.simulate != "all":
        ids = [i for i in ids if i in set(args.simulate.split(","))]
    days = list(date_range(args._from, args._to))
    # only the first device gets people; others simulate an empty secondary reader
    return [(d, SimulatedDevice(d, ids if n == 0 else [], days)) for n, d in enumerate(cfg["devices"])]


def push(fr, dev_cfg, cfg, p):
    payload = {"employee_field_value": p.user_id, "timestamp": p.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
               "device_id": dev_cfg["device_id"], "log_type": log_type(dev_cfg, p.punch, cfg)}
    if dev_cfg.get("latitude") is not None:
        payload["latitude"], payload["longitude"] = dev_cfg["latitude"], dev_cfg["longitude"]
    try:
        fr.call(CHECKIN_API, **payload)
        return "created", None
    except FrappeError as e:
        if DUPLICATE in e.message:
            return "duplicate", None
        if NO_EMPLOYEE in e.message:
            return "unmapped", None
        if INACTIVE in e.message:
            return "inactive", None
        return "failed", e.message


def sync(cfg, args, fr):
    start, end = args._from, args._to
    log.info("syncing %s → %s", start, end)
    totals = {"created": 0, "duplicate": 0, "unmapped": 0, "inactive": 0, "failed": 0}
    unmapped, failures, device_down = set(), [], False
    for dev_cfg, dev in make_devices(cfg, args, fr):
        try:
            _, punches, info = dev.read()
        except Exception as e:  # device unreachable: keep going with others, retry next run
            log.error("%s @ %s unreachable: %s", dev_cfg["device_id"], dev_cfg.get("ip"), e)
            device_down = True
            continue
        todo = [p for p in punches if start <= p.timestamp.date() <= end]
        log.info("%s (serial %s): %d punches on device, %d in range", dev_cfg["device_id"], info.get("serial"),
                 len(punches), len(todo))
        if args.dry_run:
            continue
        with cf.ThreadPoolExecutor(max_workers=cfg.get("parallel_requests", 4)) as ex:
            for p, (res, err) in zip(todo, ex.map(lambda p: push(fr, dev_cfg, cfg, p), todo)):
                totals[res] += 1
                if res == "unmapped":
                    unmapped.add(p.user_id)
                elif res == "failed":
                    failures.append((dev_cfg["device_id"], p.user_id, str(p.timestamp), err))
    log.info("punches: %s", ", ".join(f"{k} {v}" for k, v in totals.items()))
    if unmapped:
        log.warning("device user IDs with no Frappe employee (set Attendance Device ID): %s", ", ".join(sorted(unmapped)))
    for f in failures[:20]:
        log.error("failed: %s user %s at %s: %s", *f)
    return totals, failures, device_down


def fix_false_absents(fr, start, end, sync_user):
    """Punches can arrive after Frappe already auto-marked someone Absent (device was offline,
    or a backfill). Cancel those AUTO absents (never manual ones) so the day is re-processed."""
    fixed = 0
    absents = fr.get_list("Attendance", [["attendance_date", "between", [str(start), str(end)]],
                                         ["status", "=", "Absent"], ["docstatus", "=", 1],
                                         ["owner", "in", [sync_user, "Administrator"]]],
                          ["name", "employee", "attendance_date"])
    for a in absents:
        day = str(a["attendance_date"])
        logs = fr.get_list("Employee Checkin", [["employee", "=", a["employee"]], ["time", "between", [day, day]]],
                           ["name", "attendance"])
        if logs and not any(l.get("attendance") for l in logs):
            fr.cancel("Attendance", a["name"])
            fixed += 1
    if fixed:
        log.info("re-opened %d auto-absent day(s) that now have punches", fixed)
    return fixed


def process_attendance(cfg, args, fr):
    """Tell Frappe the logs are complete up to now/end-of-range, then run Auto Attendance."""
    now = dt.datetime.now()
    until = min(now, dt.datetime.combine(args._to, dt.time(23, 59, 59)))
    fix_false_absents(fr, args._from, args._to, fr.whoami())
    for shift in cfg["shifts"]:
        st = fr.get("Shift Type", shift)
        if not st:
            log.error("shift '%s' not found in Frappe", shift)
            continue
        after = dt.date.fromisoformat(str(st["process_attendance_after"])) if st.get("process_attendance_after") else None
        if after and args._from < after:
            log.warning("shift %s only processes attendance after %s (earlier days keep check-ins only)", shift, after)
        current = st.get("last_sync_of_checkin")
        if not current or dt.datetime.fromisoformat(str(current)) < until:
            fr.update("Shift Type", shift, {"last_sync_of_checkin": until.strftime("%Y-%m-%d %H:%M:%S")})
        fr.run_doc_method("Shift Type", shift, "process_auto_attendance", is_manually_triggered=1)
        log.info("auto attendance processed for %s (logs complete until %s)", shift, until)


def summary(cfg, args, fr):
    os.makedirs(cfg["log_dir"], exist_ok=True)
    for day in date_range(args._from, args._to):
        att = fr.get_list("Attendance", {"attendance_date": str(day), "docstatus": 1},
                          ["employee", "employee_name", "status", "late_entry", "working_hours"])
        if not att:
            continue
        ck = fr.get_list("Employee Checkin", [["time", "between", [str(day), str(day)]]], ["employee"])
        counts = {}
        for c in ck:
            counts[c["employee"]] = counts.get(c["employee"], 0) + 1
        single = sorted(e for e, n in counts.items() if n == 1)
        by = {}
        for a in att:
            by[a["status"]] = by.get(a["status"], 0) + 1
        late = [a for a in att if a.get("late_entry")]
        log.info("%s: %s, late %d, single punch %d", day, ", ".join(f"{k} {v}" for k, v in sorted(by.items())),
                 len(late), len(single))
        path = os.path.join(cfg["log_dir"], f"attendance_{day}.csv")
        with open(path, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["employee", "employee_name", "status", "late", "working_hours", "single_punch"])
            for a in sorted(att, key=lambda a: a["employee"]):
                w.writerow([a["employee"], a["employee_name"], a["status"], "yes" if a.get("late_entry") else "",
                            a.get("working_hours"), "yes" if a["employee"] in single else ""])


def check_mapping(cfg, args, fr):
    emps = fr.get_list("Employee", {"status": "Active"}, ["name", "employee_name", "attendance_device_id"])
    frappe_ids = {e["attendance_device_id"]: e for e in emps if e.get("attendance_device_id")}
    no_id = [e for e in emps if not e.get("attendance_device_id")]
    rc = 0
    for dev_cfg, dev in make_devices(cfg, args, fr):
        try:
            users, _, _ = dev.read()
        except Exception as e:
            print(f"{dev_cfg['device_id']}: unreachable ({e})")
            rc = 2
            continue
        on_device_only = sorted(set(users) - set(frappe_ids))
        in_frappe_only = sorted(set(frappe_ids) - set(users))
        print(f"\n{dev_cfg['device_id']}: {len(users)} users on device, {len(frappe_ids)} employees with an eSSL ID")
        print(f"  on device but not in Frappe ({len(on_device_only)}): " +
              ", ".join(f"{u} ({users[u]})" for u in on_device_only[:50]))
        print(f"  in Frappe but not on device ({len(in_frappe_only)}): " +
              ", ".join(f"{u} ({frappe_ids[u]['employee_name']})" for u in in_frappe_only[:50]))
    print(f"\nActive employees with NO eSSL ID ({len(no_id)}): " + ", ".join(e["employee_name"] for e in no_id[:50]))
    return rc


def enroll(cfg, args, fr):
    emps = fr.get_list("Employee", {"status": "Active", "attendance_device_id": ["is", "set"]},
                       ["employee_name", "attendance_device_id"])
    for dev_cfg, dev in make_devices(cfg, args, fr):
        users, _, _ = dev.read()
        missing = [e for e in emps if e["attendance_device_id"] not in users]
        print(f"{dev_cfg['device_id']}: {len(missing)} employees to add: " +
              ", ".join(f"{e['attendance_device_id']} {e['employee_name']}" for e in missing[:50]))
        if missing and args.yes:
            dev.add_users(missing)
            print("  added. Fingerprints/face still need to be enrolled at the device.")
        elif missing:
            print("  dry run. Re-run with --yes to add them.")
    return 0


def test_devices(cfg, args, fr):
    rc = 0
    try:
        print(f"Frappe: {cfg['frappe_url']} as {fr.whoami()}")
    except Exception as e:
        print(f"Frappe: UNREACHABLE ({e})")
        rc = 2
    for dev_cfg, dev in make_devices(cfg, args, fr):
        try:
            users, punches, info = dev.read()
            last = max((p.timestamp for p in punches), default=None)
            print(f"{dev_cfg['device_id']} @ {dev_cfg.get('ip')}: OK  serial={info.get('serial')} clock={info.get('time')} "
                  f"users={len(users)} punches={len(punches)} last_punch={last}")
        except Exception as e:
            print(f"{dev_cfg['device_id']} @ {dev_cfg.get('ip')}: UNREACHABLE ({e})")
            rc = 2
    return rc


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=os.path.join(HERE, "essl_config.json"))
    ap.add_argument("--date")
    ap.add_argument("--from", dest="from_")
    ap.add_argument("--to")
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--check-mapping", action="store_true")
    ap.add_argument("--enroll", action="store_true")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--simulate", help="no hardware: 'all' or comma-separated device user IDs")
    args = ap.parse_args()

    cfg = load_config(args.config)
    os.makedirs(cfg["log_dir"], exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(),
                                  logging.FileHandler(os.path.join(cfg["log_dir"], "essl_sync.log"), encoding="utf-8")])
    fr = Frappe(cfg["frappe_url"], cfg["api_key"], cfg["api_secret"], host_header=cfg.get("host_header"))

    state = load_state(cfg)
    today = dt.date.today()
    if args.date:
        args._from = args._to = dt.date.fromisoformat(args.date)
    elif args.from_:
        args._from, args._to = dt.date.fromisoformat(args.from_), dt.date.fromisoformat(args.to or str(today))
    else:  # catch up: from the last synced day (re-checked, duplicates are skipped) to today
        last = state.get("synced_until")
        args._from = dt.date.fromisoformat(last) if last else today - dt.timedelta(days=1)
        args._from = max(args._from, today - dt.timedelta(days=cfg.get("max_catchup_days", 31)))
        args._to = today

    if args.test:
        sys.exit(test_devices(cfg, args, fr))
    if args.check_mapping:
        sys.exit(check_mapping(cfg, args, fr))
    if args.enroll:
        sys.exit(enroll(cfg, args, fr))

    try:
        totals, failures, device_down = sync(cfg, args, fr)
        if args.dry_run:
            sys.exit(0)
        if device_down:
            # never advance attendance while a device's punches are missing: everyone on it
            # would be marked Absent. The next successful run processes these days.
            log.error("a device was unreachable: punches saved, attendance NOT processed. Fix and re-run.")
            sys.exit(2)
        process_attendance(cfg, args, fr)
        summary(cfg, args, fr)
    except (FrappeError, OSError) as e:
        log.error("Frappe unreachable or error: %s", e)
        sys.exit(2)
    if not failures and not device_down and not (args.date or args.from_):
        state["synced_until"] = str(args._to)
        state["last_run"] = dt.datetime.now().isoformat(timespec="seconds")
        save_state(cfg, state)
    sys.exit(2 if device_down else 1 if failures else 0)


if __name__ == "__main__":
    main()
