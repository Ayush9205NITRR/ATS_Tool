"""Minimal Frappe REST client shared by setup, eSSL sync and tests.

Auth: API key + secret (token auth) or username/password (session login).
Only depends on `requests`.
"""
import json
import time

import requests


class FrappeError(Exception):
    def __init__(self, status, message, response=None):
        super().__init__(f"{status}: {message}")
        self.status = status
        self.message = message
        self.response = response


class Frappe:
    def __init__(self, url, api_key=None, api_secret=None, host_header=None, timeout=60, retries=3):
        self.url = url.rstrip("/")
        self.s = requests.Session()
        self.s.headers["Accept"] = "application/json"
        if host_header:
            self.s.headers["Host"] = host_header
        if api_key and api_secret:
            self.s.headers["Authorization"] = f"token {api_key}:{api_secret}"
        self.timeout = timeout
        self.retries = retries

    # ---------------------------------------------------------------- core
    def _req(self, method, path, **kw):
        last = None
        for attempt in range(self.retries):
            try:
                r = self.s.request(method, self.url + path, timeout=self.timeout, **kw)
            except requests.RequestException as e:  # network blip: retry
                last = e
                time.sleep(2 ** attempt)
                continue
            if r.status_code in (502, 503, 504):
                last = FrappeError(r.status_code, "server busy")
                time.sleep(2 ** attempt)
                continue
            if r.status_code >= 400:
                raise FrappeError(r.status_code, _error_text(r), r)
            return r.json() if r.content else {}
        raise last

    def login(self, usr, pwd):
        self._req("POST", "/api/method/login", json={"usr": usr, "pwd": pwd})
        return self

    def whoami(self):
        return self._req("GET", "/api/method/frappe.auth.get_logged_user")["message"]

    # ---------------------------------------------------------------- docs
    def get(self, doctype, name):
        try:
            return self._req("GET", f"/api/resource/{doctype}/{requests.utils.quote(name, safe='')}")["data"]
        except FrappeError as e:
            if e.status == 404:
                return None
            raise

    def get_list(self, doctype, filters=None, fields=None, limit=0, order_by=None):
        params = {"limit_page_length": limit, "fields": json.dumps(fields or ["name"])}
        if filters:
            params["filters"] = json.dumps(filters)
        if order_by:
            params["order_by"] = order_by
        return self._req("GET", f"/api/resource/{doctype}", params=params)["data"]

    def exists(self, doctype, filters):
        return bool(self.get_list(doctype, filters=filters, limit=1))

    def insert(self, doc):
        return self._req("POST", f"/api/resource/{doc['doctype']}", json=doc)["data"]

    def update(self, doctype, name, values):
        return self._req("PUT", f"/api/resource/{doctype}/{requests.utils.quote(name, safe='')}", json=values)["data"]

    def delete(self, doctype, name):
        return self._req("DELETE", f"/api/resource/{doctype}/{requests.utils.quote(name, safe='')}")

    def call(self, method, http="POST", **kwargs):
        if http == "GET":
            return self._req("GET", f"/api/method/{method}", params=kwargs).get("message")
        return self._req("POST", f"/api/method/{method}", json=kwargs).get("message")

    def run_doc_method(self, doctype, name, method, **args):
        return self._req("POST", "/api/method/run_doc_method",
                         json={"dt": doctype, "dn": name, "method": method, "args": json.dumps(args)}).get("message")

    def submit(self, doctype, name):
        doc = self.get(doctype, name)
        return self.call("frappe.client.submit", doc=doc)

    def cancel(self, doctype, name):
        return self.call("frappe.client.cancel", doctype=doctype, name=name)


def _error_text(r):
    try:
        j = r.json()
    except ValueError:
        return r.text[:300]
    if j.get("exception"):
        return j["exception"].split("\n")[-1][:400] if "\n" in j["exception"] else j["exception"][:400]
    msgs = j.get("_server_messages")
    if msgs:
        try:
            return "; ".join(json.loads(m).get("message", "") for m in json.loads(msgs))[:400]
        except Exception:
            return str(msgs)[:400]
    return (j.get("message") or r.text)[:400] if isinstance(j.get("message"), str) else r.text[:400]
