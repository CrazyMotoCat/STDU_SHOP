#!/bin/sh
set -eu
su -s /bin/sh clamav -c 'exec /opt/stdu/resource-probe' &
exec /bin/sh /init
