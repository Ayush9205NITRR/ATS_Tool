"""Scale dataset for the eSSL demo + stress test.

- Shift Type "General Shift" (09:30-18:30) with auto attendance
- 500 employees with eSSL device user IDs 1001..1500 on that shift
- API user for the biometric sync tool (keys written to /work/essl_api.json)
- 100 self-service logins (emp1001..emp1100@enout.example) for load tests
"""
import json
import random

import frappe
from frappe.utils.password import update_password

frappe.init(site="hrms.localhost", sites_path=".")
frappe.connect()
frappe.set_user("Administrator")
random.seed(42)

COMPANY = "Enout Technologies"
ABBR = "ET"
N_EMP = 500
N_LOGINS = 100
SELF_SERVICE_PASSWORD = "LoadTest@2026"

FIRST = ["Aarav", "Vihaan", "Aditya", "Sai", "Krishna", "Ishaan", "Rohan", "Kabir", "Aryan", "Dev",
         "Diya", "Saanvi", "Aadhya", "Anika", "Kiara", "Myra", "Pari", "Riya", "Meera", "Tara",
         "Nikhil", "Pooja", "Karan", "Neha", "Amit", "Kavya", "Manish", "Shreya", "Rajat", "Isha"]
LAST = ["Sharma", "Verma", "Gupta", "Mehta", "Reddy", "Nair", "Iyer", "Patel", "Joshi", "Kulkarni",
        "Das", "Bose", "Singh", "Yadav", "Chauhan", "Mishra", "Pandey", "Agarwal", "Kapoor", "Malhotra"]
DEPTS = ["Engineering", "Sales", "Operations", "Human Resources"]
DESIG = {"Engineering": "Software Engineer", "Sales": "Sales Executive",
         "Operations": "Field Engineer", "Human Resources": "HR Manager"}

# ---- shift with auto attendance
if not frappe.db.exists("Shift Type", "General Shift"):
    frappe.get_doc({
        "doctype": "Shift Type", "name": "General Shift", "__newname": "General Shift",
        "start_time": "09:30:00", "end_time": "18:30:00",
        "enable_auto_attendance": 1,
        "determine_check_in_and_check_out": "Alternating entries as IN and OUT during the same shift",
        "working_hours_calculation_based_on": "First Check-in and Last Check-out",
        "begin_check_in_before_shift_start_time": 120,
        "allow_check_out_after_shift_end_time": 240,
        "working_hours_threshold_for_half_day": 4,
        "working_hours_threshold_for_absent": 2,
        "enable_late_entry_marking": 1, "late_entry_grace_period": 15,
        "process_attendance_after": "2026-10-30",
        "last_sync_of_checkin": "2026-10-30 23:59:59",
        "holiday_list": "India 2026",
    }).insert()
    frappe.db.commit()
    print("shift created")

# ---- 500 employees
existing = set(frappe.get_all("Employee", filters={"attendance_device_id": ["in", [str(x) for x in range(1001, 1501)]]},
                              pluck="attendance_device_id"))
frappe.flags.in_import = True
created = 0
for i in range(N_EMP):
    dev = str(1001 + i)
    if dev in existing:
        continue
    dept = DEPTS[i % len(DEPTS)]
    frappe.get_doc({
        "doctype": "Employee", "first_name": random.choice(FIRST), "last_name": random.choice(LAST),
        "gender": random.choice(["Male", "Female"]), "date_of_birth": f"19{random.randint(80, 99)}-0{random.randint(1, 9)}-1{random.randint(0, 9)}",
        "date_of_joining": "2025-04-01", "company": COMPANY, "department": f"{dept} - {ABBR}",
        "designation": DESIG[dept], "attendance_device_id": dev, "default_shift": "General Shift",
        "holiday_list": "India 2026", "status": "Active",
    }).insert()
    created += 1
    if created % 100 == 0:
        frappe.db.commit()
        print("employees", created, flush=True)
frappe.db.commit()
frappe.flags.in_import = False
print("employees created", created)

# ---- API user for the sync tool
api_user = "essl-sync@enout.example"
if not frappe.db.exists("User", api_user):
    frappe.get_doc({"doctype": "User", "email": api_user, "first_name": "eSSL", "last_name": "Sync",
                    "user_type": "System User", "send_welcome_email": 0,
                    "roles": [{"role": "HR User"}, {"role": "HR Manager"}]}).insert()
from frappe.core.doctype.user.user import generate_keys
secret = generate_keys(api_user)["api_secret"]
key = frappe.db.get_value("User", api_user, "api_key")
json.dump({"api_key": key, "api_secret": secret}, open("/work/essl_api.json", "w"))
frappe.db.commit()
print("api user ready")

# ---- self-service logins
emps = frappe.get_all("Employee", filters={"attendance_device_id": ["in", [str(x) for x in range(1001, 1001 + N_LOGINS)]]},
                      fields=["name", "first_name", "last_name", "attendance_device_id", "user_id"])
logins = []
frappe.flags.in_import = True  # skip per-hour user-creation throttle for seeding
for e in emps:
    email = f"emp{e.attendance_device_id}@enout.example"
    if not frappe.db.exists("User", email):
        frappe.get_doc({"doctype": "User", "email": email, "first_name": e.first_name, "last_name": e.last_name,
                        "user_type": "System User", "send_welcome_email": 0,
                        "roles": [{"role": "Employee"}, {"role": "Employee Self Service"}]}).insert()
        update_password(email, SELF_SERVICE_PASSWORD)
    if e.user_id != email:
        doc = frappe.get_doc("Employee", e.name)
        doc.user_id = email
        doc.create_user_permission = 1
        doc.save()
    logins.append({"email": email, "employee": e.name})
frappe.db.commit()
json.dump({"password": SELF_SERVICE_PASSWORD, "users": logins}, open("/work/loadtest_users.json", "w"))
print("logins", len(logins))

# leave allocations for login users so leave balance calls return data
for u in logins:
    for lt, n in [("Casual Leave", 12), ("Sick Leave", 8)]:
        if not frappe.db.exists("Leave Allocation", {"employee": u["employee"], "leave_type": lt, "docstatus": 1}):
            a = frappe.get_doc({"doctype": "Leave Allocation", "employee": u["employee"], "leave_type": lt,
                                "from_date": "2026-01-01", "to_date": "2026-12-31", "new_leaves_allocated": n})
            a.insert(); a.submit()
frappe.db.commit()
print("done")
