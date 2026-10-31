# Bounded synthetic archive diagnostic, custom signature only; NOT acceptance.
# MaxScanTime engine value is unchanged. No host mounts, network or volumes.
$experiment = @'
set -u
mkdir /tmp/db /tmp/inputs
printf "Pcre.Test;Engine:81-255,Target:0;1;414243444546;0/XYZ123/\n" > /tmp/db/test.ldb
cat > /tmp/clamd.conf <<'CONFIG'
Foreground yes
DatabaseDirectory /tmp/db
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
CONFIG
for n in 1 2 3 4; do
  head -c 8388608 /dev/zero > /tmp/inputs/$n.csv || exit 7
  test "$(wc -c < /tmp/inputs/$n.csv)" -eq 8388608 || exit 8
done
tar -czf /tmp/fixture.tar.gz -C /tmp/inputs . || exit 9
tar -tzf /tmp/fixture.tar.gz || exit 10
gzip -t /tmp/fixture.tar.gz || exit 11
wc -c /tmp/fixture.tar.gz /tmp/inputs/*.csv
sha256sum /tmp/fixture.tar.gz
clamd --config-file=/tmp/clamd.conf > /tmp/clamd.log 2>&1 &
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  test -S /tmp/c.sock && break
  sleep 1
done
test -S /tmp/c.sock || exit 2
version=$(printf 'zVERSION\000' | nc -w 3 127.0.0.1 3310 | tr -d '\000')
echo "$version"
test "$version" = 'ClamAV 1.4.6' || exit 14
echo "TIME_START=$(date +%s)"
scan_output=$(timeout 125 clamdscan --config-file=/tmp/clamd.conf --stream --no-summary /tmp/fixture.tar.gz)
scan_status=$?
printf '%s\n' "$scan_output"
if test "$scan_status" = 124; then echo TEST_DEADLINE >&2; exit 124; fi
echo "SCAN_EXIT=$scan_status"
echo "TIME_END=$(date +%s)"
grep -E 'Global time limit|Global size limit|File size limit|PCREMaxFileSize' /tmp/clamd.log
# Nonzero, timeout, or a limit alert remains a real diagnostic failure.
test "$scan_status" = 0 || exit 12
printf '%s\n' "$scan_output" | grep -Fx '/tmp/fixture.tar.gz: OK' >/dev/null || exit 13
'@
docker run --rm --network none --memory 1g --cpus 1 --pids-limit 64 --entrypoint sh `
  'clamav/clamav:1.4.6@sha256:982e28f90061d0e66eb03276419f589a47c9fa601e985e472fc2f6c64b497ca0' `
  -c $experiment
exit $LASTEXITCODE
