#!/bin/bash
set -ex
export PATH="$NVM_DIR/versions/node/v22.23.4/bin:$PATH"
printf '[client]\nskip-ssl\n[mysql]\nskip-ssl\n[mysqldump]\nskip-ssl\n' > ~/.my.cnf
cd /home/frappe/frappe-bench
bench new-site hrms.localhost --force --mariadb-root-password 123 --admin-password admin --db-root-username root --mariadb-user-host-login-scope='%'
bench --site hrms.localhost install-app erpnext
bench --site hrms.localhost install-app hrms
bench --site hrms.localhost enable-scheduler
bench use hrms.localhost
echo SETUP_DONE
