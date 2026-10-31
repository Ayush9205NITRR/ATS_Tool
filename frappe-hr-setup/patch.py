import json, re, sys, pathlib
app = pathlib.Path(sys.argv[1])
for pj in [app/"package.json", *app.glob("*/package.json"), *app.glob("frontend/package.json")]:
    if not pj.exists() or "node_modules" in str(pj): continue
    t = pj.read_text()
    n = re.sub(r'"github:([\w.-]+/[\w.-]+?)(#[^"]*)?"', lambda m: f'"git+https://github.com/{m.group(1)}.git{m.group(2) or ""}"', t)
    if n != t:
        pj.write_text(n); print("patched", pj)
        lock = pj.parent/"yarn.lock"
        if lock.exists():
            blocks = lock.read_text().split("\n\n")
            lock.write_text("\n\n".join(b for b in blocks if "codeload.github.com" not in b and "github:" not in b.split("\n")[0]))
            print("cleaned", lock)
