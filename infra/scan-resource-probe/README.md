# R1-010D scanner resource probe

The isolated test image builds a static Go executable from the pinned Go image and runs it as `clamav` alongside the pinned ClamAV image. The scanner uses `TemporaryDirectory /tmp`; its test Compose mounts a private 512 MiB tmpfs there. The probe binds only to the scanner's address on the isolated scanner network, with no host-published port. It has no database credentials or private inquiry storage.

The probe requires at least 384 MiB of free scratch space and a free inode. This reserves the configured 256 MiB `MaxScanSize` plus 128 MiB of headroom. This threshold is a test operating gate, not a guarantee that all possible archives fit; ClamAV limit alerts, errors, interruption and incomplete scans still fail closed. The probe checks the actual tmpfs mount and its 512 MiB capacity, rather than host free space.

Only private cgroup v2 is supported. The probe reads its own `memory.events.local`; missing or malformed `oom` or `oom_kill` counters, a nonzero OOM counter, or unsupported cgroup configuration makes it unavailable. If `oom_group_kill` is present, it must also be zero. Counters are monotonic: after an OOM event the scanner container must be restarted, and the new probe/scanner identity must be re-attested. Ordinary `high` or `max` memory pressure counts alone are not OOM events.

The worker requests a bounded, fresh resource snapshot on the same private host as clamd before streaming and before finalization. Scanner process start time and a random per-probe instance identifier must match across those checks. The probe response never contains document bytes, filenames, storage keys, capability tokens or database credentials. A missing or unsafe snapshot prevents CLEAN and REJECTED.

Measurements in this disposable environment do not establish production VDS capacity. Production deployment, scratch sizing and signature-update egress remain separately gated.
