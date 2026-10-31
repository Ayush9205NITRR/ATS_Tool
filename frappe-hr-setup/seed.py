"""Seed a demo Frappe HR site: India company, leave types, employees,
eSSL/remote check-ins, attendance, and an October payroll run."""
import random
import sys
from datetime import date, datetime, timedelta

import frappe

STAGE = sys.argv[1] if len(sys.argv) > 1 else "all"
frappe.init(site="hrms.localhost", sites_path=".")
frappe.connect()
frappe.set_user("Administrator")
random.seed(7)

COMPANY = "Enout Technologies"
ABBR = "ET"
YEAR = 2026


def log(*a):
    print("[seed]", *a, flush=True)


def ensure(doctype, name, **fields):
    if frappe.db.exists(doctype, name):
        return frappe.get_doc(doctype, name)
    d = frappe.get_doc({"doctype": doctype, **fields})
    d.insert(ignore_permissions=True)
    return d


# ---------------------------------------------------------------- setup wizard
def wizard():
    if frappe.db.exists("Company", COMPANY):
        log("wizard already done")
        return
    from frappe.desk.page.setup_wizard.setup_wizard import setup_complete

    setup_complete({
        "language": "English", "country": "India", "timezone": "Asia/Kolkata",
        "currency": "INR", "full_name": "Ayush Admin", "email": "admin@example.com",
        "password": "admin", "company_name": COMPANY, "company_abbr": ABBR,
        "chart_of_accounts": "Standard", "fy_start_date": f"{YEAR}-04-01",
        "fy_end_date": f"{YEAR+1}-03-31", "setup_demo": 0,
    })
    frappe.db.commit()
    log("wizard done")


# ---------------------------------------------------------------- masters
def masters():
    # Fiscal year covering Jan-Mar 2026 too (payroll/leave periods)
    ensure("Fiscal Year", f"{YEAR-1}-{YEAR}", year=f"{YEAR-1}-{YEAR}",
           year_start_date=f"{YEAR-1}-04-01", year_end_date=f"{YEAR}-03-31")

    # Holidays: weekly offs + national holidays
    if not frappe.db.exists("Holiday List", f"India {YEAR}"):
        hl = frappe.get_doc({"doctype": "Holiday List", "holiday_list_name": f"India {YEAR}",
                             "from_date": f"{YEAR}-01-01", "to_date": f"{YEAR}-12-31",
                             "weekly_off": "Sunday"})
        hl.get_weekly_off_dates()
        for d, desc in [("01-26", "Republic Day"), ("03-04", "Holi"), ("08-15", "Independence Day"),
                        ("10-02", "Gandhi Jayanti"), ("10-20", "Dussehra"), ("11-08", "Diwali"),
                        ("12-25", "Christmas")]:
            if f"{YEAR}-{d}" not in {str(h.holiday_date) for h in hl.holidays}:
                hl.append("holidays", {"holiday_date": f"{YEAR}-{d}", "description": desc})
        hl.insert()
    frappe.db.set_value("Company", COMPANY, "default_holiday_list", f"India {YEAR}")

    # Optional (observance) holidays employees may pick from
    if not frappe.db.exists("Holiday List", f"Observance {YEAR}"):
        ol = frappe.get_doc({"doctype": "Holiday List", "holiday_list_name": f"Observance {YEAR}",
                             "from_date": f"{YEAR}-01-01", "to_date": f"{YEAR}-12-31"})
        for d, desc in [("01-14", "Makar Sankranti"), ("03-20", "Eid-ul-Fitr"), ("08-28", "Raksha Bandhan"),
                        ("09-04", "Janmashtami"), ("10-29", "Karwa Chauth"), ("11-10", "Bhai Dooj")]:
            ol.append("holidays", {"holiday_date": f"{YEAR}-{d}", "description": desc})
        ol.insert()

    # The three leave types requested
    ensure("Leave Type", "Casual Leave", leave_type_name="Casual Leave", max_leaves_allowed=12,
           allow_negative=0, include_holiday=0)
    ensure("Leave Type", "Sick Leave", leave_type_name="Sick Leave", max_leaves_allowed=8,
           include_holiday=0)
    ensure("Leave Type", "Observance Leave", leave_type_name="Observance Leave", max_leaves_allowed=2,
           is_optional_leave=1)

    for dept in ["Engineering", "Sales", "Human Resources", "Operations"]:
        if not frappe.db.exists("Department", f"{dept} - {ABBR}"):
            ensure("Department", f"{dept} - {ABBR}", department_name=dept, company=COMPANY)
    for des in ["Software Engineer", "Sales Executive", "HR Manager", "Operations Lead", "Field Engineer"]:
        ensure("Designation", des, designation_name=des)

    # Leave period + optional holiday list for Observance Leave
    if not frappe.db.exists("Leave Period", {"from_date": f"{YEAR}-01-01"}):
        frappe.get_doc({"doctype": "Leave Period", "from_date": f"{YEAR}-01-01",
                        "to_date": f"{YEAR}-12-31", "company": COMPANY, "is_active": 1,
                        "optional_holiday_list": f"Observance {YEAR}"}).insert()
    frappe.db.commit()
    log("masters done")


EMPLOYEES = [
    # first, last, gender, dept, designation, ctc(monthly basic+hra base), essl id, remote, city
    ("Priya", "Sharma", "Female", "Human Resources", "HR Manager", 70000, "101", False),
    ("Rahul", "Verma", "Male", "Engineering", "Software Engineer", 90000, "102", False),
    ("Ananya", "Iyer", "Female", "Engineering", "Software Engineer", 85000, "103", True),
    ("Vikram", "Singh", "Male", "Sales", "Sales Executive", 55000, "104", True),
    ("Sneha", "Patel", "Female", "Operations", "Operations Lead", 65000, "105", False),
    ("Arjun", "Nair", "Male", "Operations", "Field Engineer", 45000, "106", True),
]


def employees():
    out = []
    for i, (f, l, g, dept, des, ctc, dev, remote) in enumerate(EMPLOYEES):
        name = frappe.db.get_value("Employee", {"first_name": f, "last_name": l})
        if not name:
            e = frappe.get_doc({
                "doctype": "Employee", "first_name": f, "last_name": l, "gender": g,
                "date_of_birth": f"199{i}-0{i+1}-1{i}", "date_of_joining": f"2025-0{i+1}-01",
                "company": COMPANY, "department": f"{dept} - {ABBR}", "designation": des,
                "attendance_device_id": dev, "holiday_list": f"India {YEAR}", "status": "Active",
                "ctc": ctc * 12, "salary_currency": "INR", "salary_mode": "Bank",
                "company_email": f"{f.lower()}@enout.example", "prefered_contact_email": "Company Email",
                "cell_number": f"98{random.randint(10000000, 99999999)}",
            })
            e.insert()
            name = e.name
        out.append(name)
    # Priya is everyone's leave approver / reports-to
    hr = out[0]
    for n in out[1:]:
        frappe.db.set_value("Employee", n, "reports_to", hr)
    frappe.db.commit()
    log("employees", out)
    return out


def allocations(emps):
    for e in emps:
        for lt, n in [("Casual Leave", 12), ("Sick Leave", 8), ("Observance Leave", 2)]:
            if frappe.db.exists("Leave Allocation", {"employee": e, "leave_type": lt, "docstatus": 1}):
                continue
            a = frappe.get_doc({"doctype": "Leave Allocation", "employee": e, "leave_type": lt,
                                "from_date": f"{YEAR}-01-01", "to_date": f"{YEAR}-12-31",
                                "new_leaves_allocated": n})
            a.insert()
            a.submit()
    frappe.db.commit()
    log("allocations done")


def leaves(emps):
    if frappe.db.count("Leave Application") >= 5:
        log("leaves exist")
        return
    plan = [
        (emps[1], "Casual Leave", "2026-10-07", "2026-10-08", "Approved", "Family function in Jaipur"),
        (emps[2], "Sick Leave", "2026-10-14", "2026-10-14", "Approved", "Fever"),
        (emps[3], "Observance Leave", "2026-10-29", "2026-10-29", "Approved", "Karwa Chauth"),
        (emps[4], "Casual Leave", "2026-11-12", "2026-11-13", "Open", "Personal work"),
        (emps[5], "Sick Leave", "2026-11-03", "2026-11-04", "Open", "Doctor appointment"),
        (emps[1], "Observance Leave", "2026-11-10", "2026-11-10", "Open", "Bhai Dooj"),
    ]
    approver = frappe.db.get_value("Employee", emps[0], "user_id") or "Administrator"
    for e, lt, fd, td, status, reason in plan:
        la = frappe.get_doc({"doctype": "Leave Application", "employee": e, "leave_type": lt,
                             "from_date": fd, "to_date": td, "description": reason,
                             "leave_approver": "Administrator", "status": status,
                             "posting_date": "2026-10-01", "follow_via_email": 0})
        la.insert()
        if status == "Approved":
            la.submit()
    frappe.db.commit()
    log("leaves done")


def attendance(emps):
    """October 2026: eSSL punches for office staff, geo check-ins for remote staff,
    and the resulting daily Attendance records."""
    if frappe.db.count("Employee Checkin") > 50:
        log("checkins exist")
        return
    from hrms.hr.utils import get_holiday_dates_for_employee

    on_leave = {}
    for la in frappe.get_all("Leave Application", filters={"docstatus": 1},
                             fields=["employee", "from_date", "to_date", "leave_type", "name"]):
        d = la.from_date
        while d <= la.to_date:
            on_leave[(la.employee, d)] = la
            d += timedelta(days=1)

    start, end = date(2026, 10, 1), date(2026, 10, 30)
    locs = {2: (12.9716, 77.5946), 3: (19.0760, 72.8777), 5: (23.0225, 72.5714)}
    for idx, e in enumerate(emps):
        remote = EMPLOYEES[idx][7]
        hol = set(str(h) for h in get_holiday_dates_for_employee(e, start, end))
        d = start
        while d <= end:
            if str(d) in hol:
                d += timedelta(days=1)
                continue
            la = on_leave.get((e, d))
            if la:
                d += timedelta(days=1)
                continue  # attendance auto-marked "On Leave" by approved application
            absent = random.random() < 0.04
            if absent:
                att_status = "Absent"
            else:
                att_status = "Work From Home" if remote else "Present"
                tin = datetime.combine(d, datetime.min.time()) + timedelta(
                    hours=9, minutes=random.randint(0, 45))
                tout = tin + timedelta(hours=8, minutes=random.randint(30, 90))
                for t, lt in [(tin, "IN"), (tout, "OUT")]:
                    ck = {"doctype": "Employee Checkin", "employee": e, "time": t, "log_type": lt,
                          "device_id": "Frappe HR App (GPS)" if remote else "eSSL X990 - Main Gate"}
                    if remote and idx in locs:
                        ck["latitude"], ck["longitude"] = locs[idx]
                    frappe.get_doc(ck).insert()
            if not frappe.db.exists("Attendance", {"employee": e, "attendance_date": d, "docstatus": ("!=", 2)}):
                a = frappe.get_doc({"doctype": "Attendance", "employee": e, "attendance_date": d,
                                    "status": att_status, "company": COMPANY})
                if att_status != "Absent":
                    a.working_hours = round(random.uniform(8.3, 9.4), 2)
                a.insert()
                a.submit()
            d += timedelta(days=1)
    frappe.db.commit()
    log("attendance done")


def payroll(emps):
    for comp, abbr, typ in [("Basic Salary", "B", "Earning"), ("House Rent Allowance", "HRA", "Earning"),
                            ("Special Allowance", "SA", "Earning"),
                            ("Provident Fund", "PF", "Deduction"), ("Professional Tax", "PT", "Deduction")]:
        if not frappe.db.exists("Salary Component", comp):
            frappe.get_doc({"doctype": "Salary Component", "salary_component": comp,
                            "salary_component_abbr": abbr, "type": typ,
                            "depends_on_payment_days": 0 if abbr == "PT" else 1}).insert()

    ss_name = "India Standard 2026"
    if not frappe.db.exists("Salary Structure", ss_name):
        ss = frappe.get_doc({
            "doctype": "Salary Structure", "name": ss_name, "__newname": ss_name,
            "company": COMPANY, "payroll_frequency": "Monthly", "currency": "INR",
            "is_active": "Yes",
            "earnings": [
                {"salary_component": "Basic Salary", "amount_based_on_formula": 1, "formula": "base * 0.5"},
                {"salary_component": "House Rent Allowance", "amount_based_on_formula": 1, "formula": "base * 0.2"},
                {"salary_component": "Special Allowance", "amount_based_on_formula": 1, "formula": "base * 0.3"},
            ],
            "deductions": [
                {"salary_component": "Provident Fund", "amount_based_on_formula": 1, "formula": "B_1 * 0.12 if B_1 <= 15000 else 1800"},
                {"salary_component": "Professional Tax", "amount": 200},
            ],
        })
        ss.insert()
        ss.submit()

    payable = frappe.db.get_value("Account", {"company": COMPANY, "account_name": "Payroll Payable"})
    if payable:
        frappe.db.set_value("Company", COMPANY, "default_payroll_payable_account", payable)
    for idx, e in enumerate(emps):
        if not frappe.db.exists("Salary Structure Assignment", {"employee": e, "docstatus": 1}):
            ssa = frappe.get_doc({"doctype": "Salary Structure Assignment", "employee": e,
                                  "salary_structure": ss_name, "company": COMPANY,
                                  "from_date": "2026-04-01", "base": EMPLOYEES[idx][5],
                                  "currency": "INR", "income_tax_slab": None,
                                  "payroll_payable_account": payable})
            ssa.insert()
            ssa.submit()

    frappe.db.commit()
    if not frappe.db.exists("Payroll Entry", {"start_date": "2026-10-01"}):
        cc = frappe.db.get_value("Company", COMPANY, "cost_center")
        pay_acc = frappe.db.get_value("Account", {"company": COMPANY, "account_type": "Bank", "is_group": 0}) \
            or frappe.db.get_value("Account", {"company": COMPANY, "account_type": "Cash", "is_group": 0})
        pe = frappe.get_doc({"doctype": "Payroll Entry", "company": COMPANY, "posting_date": "2026-10-31",
                             "payroll_frequency": "Monthly", "start_date": "2026-10-01",
                             "end_date": "2026-10-31", "currency": "INR", "exchange_rate": 1,
                             "cost_center": cc, "payroll_payable_account": payable,
                             "payment_account": pay_acc})
        pe.insert()
        pe.fill_employee_details()
        pe.save()
        frappe.db.commit()
        pe.submit()  # on_submit creates the salary slips
        frappe.db.commit()
    frappe.db.commit()
    log("payroll done", frappe.db.count("Salary Slip"))


if STAGE in ("all", "wizard"):
    wizard()
if STAGE in ("all", "data"):
    masters()
    emps = employees()
    allocations(emps)
    leaves(emps)
    attendance(emps)
    payroll(emps)
frappe.db.commit()
frappe.destroy()
