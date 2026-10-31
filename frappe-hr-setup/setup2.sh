#!/bin/bash
set -ex
export PATH="$NVM_DIR/versions/node/v22.23.4/bin:$PATH"
git config --global http.sslCAInfo /work/ca.crt
cd /home/frappe/frappe-bench
P=~/.pyenv/versions/3.12.16/bin/python
$P /work/patch.py apps/frappe
./env/bin/python -c "import frappe" 2>/dev/null || ./env/bin/pip install -q -e apps/frappe
grep -qx frappe sites/apps.txt 2>/dev/null || echo frappe > sites/apps.txt
[ -f sites/common_site_config.json ] || echo "{}" > sites/common_site_config.json
(cd apps/frappe && yarn install --check-files)
bench set-mariadb-host 127.0.0.1
bench set-redis-cache-host redis://127.0.0.1:6379
bench set-redis-queue-host redis://127.0.0.1:6379
bench set-redis-socketio-host redis://127.0.0.1:6379
[ -f Procfile ] || bench setup procfile
sed -i '/redis/d;/watch/d' ./Procfile
for a in erpnext hrms; do
  [ -d apps/$a ] || bench get-app --branch version-15 --skip-assets https://github.com/frappe/$a 
  $P /work/patch.py apps/$a
  for d in apps/$a apps/$a/frontend; do [ -f $d/package.json ] && (cd $d && yarn install --check-files); done
done
bench build
bench new-site hrms.localhost --force --mariadb-root-password 123 --admin-password admin --db-root-username root --mariadb-user-host-login-scope='%'
bench --site hrms.localhost install-app erpnext
bench --site hrms.localhost install-app hrms
bench --site hrms.localhost enable-scheduler
bench use hrms.localhost
echo SETUP_DONE
