# Bounded direct diagnostic only: the image's official signature DB is stale.
# This never modifies application services, time, databases or production data.
$experiment = @'
set -u
cat > /tmp/clamd.conf <<'CONFIG'
Foreground yes
DatabaseDirectory /var/lib/clamav
TCPSocket 3310
TCPAddr 127.0.0.1
LocalSocket /tmp/c.sock
MaxFileSize 64M
MaxScanSize 256M
StreamMaxLength 64M
MaxFiles 10000
MaxRecursion 10
PCREMaxFileSize 64M
MaxScanTime 120000
AlertExceedsMax yes
AlertEncrypted yes
CONFIG
yes parameter,value | head -c 52428800 > /tmp/fixture.csv
wc -c -l /tmp/fixture.csv
sha256sum /tmp/fixture.csv
test "$(wc -c < /tmp/fixture.csv | tr -d ' ')" = 52428800 || exit 3
test "$(wc -l < /tmp/fixture.csv | tr -d ' ')" = 3276800 || exit 4
test "$(sha256sum /tmp/fixture.csv | cut -d ' ' -f 1)" = 6785afaf03b5938531b42865de01c962a95749fa5009a16247a9a52602a69155 || exit 5
clamd --config-file=/tmp/clamd.conf > /tmp/clamd.log 2>&1 &
for attempt in $(seq 1 90); do
  test -S /tmp/c.sock && break
  sleep 1
done
test -S /tmp/c.sock || exit 2
version=$(printf 'zVERSION\000' | nc -w 3 127.0.0.1 3310 | tr -d '\000')
echo "$version"
test "$version" = 'ClamAV 1.4.6/28164/Sun Oct 25 06:24:12 2026' || exit 6
echo "TIME_START=$(date +%s)"
scan_output=$(time timeout 125 clamdscan --config-file=/tmp/clamd.conf --stream --no-summary /tmp/fixture.csv)
scan_status=$?
echo "$scan_output"
echo "SCAN_EXIT=$scan_status"
if test "$scan_status" = 124; then echo TEST_DEADLINE >&2; exit 124; fi
echo "TIME_END=$(date +%s)"
grep -E 'Global time limit|Global size limit|File size limit|PCREMaxFileSize' /tmp/clamd.log
test "$scan_status" = 0 || exit 7
test "$scan_output" = '/tmp/fixture.csv: OK' || exit 8
'@
docker run --rm --network none --memory 2g --cpus 1 --pids-limit 64 --entrypoint sh `
  'clamav/clamav:1.4.6@sha256:982e28f90061d0e66eb03276419f589a47c9fa601e985e472fc2f6c64b497ca0' `
  -c $experiment
exit $LASTEXITCODE
