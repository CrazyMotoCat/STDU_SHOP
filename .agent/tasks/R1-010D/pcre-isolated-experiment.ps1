# Synthetic isolated PCRE mechanics only; this is NOT official-DB acceptance.
# No persistent volumes, host mounts, network, or application services.
$experiment = @'
set -u
mkdir /tmp/db
printf "Pcre.Test;Engine:81-255,Target:0;1;414243444546;0/XYZ123/\n" > /tmp/db/test.ldb
cat > /tmp/clamd.conf <<'CONFIG'
Foreground yes
DatabaseDirectory /tmp/db
TCPSocket 3310
TCPAddr 127.0.0.1
LocalSocket /tmp/c.sock
MaxFileSize 70M
MaxScanSize 256M
StreamMaxLength 70M
PCREMaxFileSize 64M
MaxScanTime 120000
AlertExceedsMax yes
CONFIG
for size in 67108863 67108864 67108865; do
  printf ABCDEFXYZ123 > /tmp/fixture-$size
  head -c $((size-12)) /dev/zero >> /tmp/fixture-$size || exit 7
  test "$(wc -c < /tmp/fixture-$size)" -eq "$size" || exit 8
done
sha256sum /tmp/fixture-*
clamd --config-file=/tmp/clamd.conf > /tmp/clamd.log 2>&1 &
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  test -S /tmp/c.sock && break
  sleep 1
done
test -S /tmp/c.sock || exit 2
version=$(printf 'zVERSION\000' | nc -w 3 127.0.0.1 3310 | tr -d '\000')
echo "$version"
test "$version" = 'ClamAV 1.4.6' || exit 14
date -u
scan_output=$(timeout 30 clamdscan --config-file=/tmp/clamd.conf --stream --no-summary /tmp/fixture-67108863 /tmp/fixture-67108864 /tmp/fixture-67108865)
scan_status=$?
if test "$scan_status" = 124; then echo TEST_DEADLINE >&2; exit 124; fi
printf '%s\n' "$scan_output"
date -u
grep -E 'PCREMaxFileSize|Global time limit|File size limit|Global size limit' /tmp/clamd.log
# FOUND on the first two inputs gives clamdscan exit 1.
test "$scan_status" = 1 || exit 6
printf '%s\n' "$scan_output" | grep -Fx '/tmp/fixture-67108863: Pcre.Test.UNOFFICIAL FOUND' >/dev/null || exit 3
printf '%s\n' "$scan_output" | grep -Fx '/tmp/fixture-67108864: Pcre.Test.UNOFFICIAL FOUND' >/dev/null || exit 4
printf '%s\n' "$scan_output" | grep -Fx '/tmp/fixture-67108865: OK' >/dev/null || exit 5
'@
docker run --rm --network none --memory 1g --cpus 1 --pids-limit 64 --entrypoint sh `
  'clamav/clamav:1.4.6@sha256:982e28f90061d0e66eb03276419f589a47c9fa601e985e472fc2f6c64b497ca0' `
  -c $experiment
exit $LASTEXITCODE
