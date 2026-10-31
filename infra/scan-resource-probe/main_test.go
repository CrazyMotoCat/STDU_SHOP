package main

import (
	"errors"
	"syscall"
	"testing"
	"time"
)

func TestMeasureFailClosed(t *testing.T) {
	files := map[string]string{
		"/etc/clamav/clamd.conf":             "TemporaryDirectory /tmp\n",
		"/proc/self/mountinfo":               "1372 1363 0:218 / /tmp rw - tmpfs tmpfs rw,size=524288k\n",
		"/proc/self/cgroup":                  "0::/\n",
		"/sys/fs/cgroup/memory.events.local": "oom 0\noom_kill 0\n",
		"/sys/fs/cgroup/memory.events":       "oom 10\noom_kill 10\n",
	}
	fs := syscall.Statfs_t{Bsize: 4096, Blocks: 131072, Bavail: 98304, Ffree: 1}
	inputs := probeInputs{
		readFile: func(path string) ([]byte, error) {
			v, ok := files[path]
			if !ok {
				return nil, errors.New("unavailable")
			}
			return []byte(v), nil
		},
		statfs:          func(_ string, out *syscall.Statfs_t) error { *out = fs; return nil },
		scannerIdentity: func() (string, error) { return "42:100", nil },
		now:             func() time.Time { return time.Unix(10, 0) },
	}
	if got, err := measureWith("instance", inputs); err != nil || !got.Ready {
		t.Fatalf("valid local cgroup rejected: %v", err)
	}
	for path, invalid := range map[string]string{
		"/proc/self/cgroup":                  "2:memory:/host/container\n",
		"/sys/fs/cgroup/memory.events.local": "oom invalid\noom_kill 0\n",
		"/etc/clamav/clamd.conf":             "TemporaryDirectory /other\n",
	} {
		saved := files[path]
		files[path] = invalid
		if _, err := measureWith("instance", inputs); err == nil {
			t.Fatalf("invalid %s accepted", path)
		}
		files[path] = saved
	}
	for _, path := range []string{"/etc/clamav/clamd.conf", "/proc/self/mountinfo", "/proc/self/cgroup", "/sys/fs/cgroup/memory.events.local"} {
		saved := files[path]
		delete(files, path)
		if _, err := measureWith("instance", inputs); err == nil {
			t.Fatalf("missing %s accepted", path)
		}
		files[path] = saved
	}
	inputs.statfs = func(string, *syscall.Statfs_t) error { return errors.New("statfs failed") }
	if _, err := measureWith("instance", inputs); err == nil {
		t.Fatal("statfs failure accepted")
	}
}

func TestScratchBoundaries(t *testing.T) {
	healthy := syscall.Statfs_t{Bsize: 4096, Blocks: 131072, Bavail: 98304, Ffree: 1}
	if _, err := scratchAvailable(healthy); err != nil {
		t.Fatal(err)
	}
	for _, fs := range []syscall.Statfs_t{
		{Bsize: 4096, Blocks: 131072, Bavail: 98303, Ffree: 1},
		{Bsize: 4096, Blocks: 131072, Bavail: 0, Ffree: 1},
		{Bsize: 4096, Blocks: 131072, Bavail: 98304, Ffree: 0},
		{Bsize: 4096, Blocks: 131071, Bavail: 98304, Ffree: 1},
	} {
		if _, err := scratchAvailable(fs); err == nil {
			t.Fatal("unsafe scratch accepted")
		}
	}
}

func TestScratchConfiguration(t *testing.T) {
	if !validTemporaryDirectory("#TemporaryDirectory /var/tmp\nTemporaryDirectory /tmp\n") {
		t.Fatal("valid config rejected")
	}
	for _, config := range []string{"", "TemporaryDirectory /var/tmp", "TemporaryDirectory /tmp\nTemporaryDirectory /var/tmp"} {
		if validTemporaryDirectory(config) {
			t.Fatal("unsafe config accepted")
		}
	}
	mount := "1372 1363 0:218 / /tmp rw,nosuid,nodev - tmpfs tmpfs rw,size=524288k\n"
	if !validScratchMount(mount) {
		t.Fatal("valid mount rejected")
	}
	if validScratchMount("") || validScratchMount(mount+mount) || validScratchMount("1372 1363 0:218 / /tmp rw - ext4 disk rw") {
		t.Fatal("unsafe mount accepted")
	}
}

func TestCounters(t *testing.T) {
	cases := []struct {
		name, data string
		ok         bool
	}{
		{"healthy", "low 4\nhigh 3\noom 0\noom_kill 0\noom_group_kill 0\n", true},
		{"oom", "oom 1\noom_kill 0\n", false},
		{"killed", "oom 0\noom_kill 1\n", false},
		{"group", "oom 0\noom_kill 0\noom_group_kill 1\n", false},
		{"missing", "oom 0\n", false},
		{"bad", "oom bad\noom_kill 0\n", false},
		{"duplicate", "oom 0\noom 0\noom_kill 0\n", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := counters(tc.data)
			if (err == nil) != tc.ok {
				t.Fatalf("unexpected result: %v", err)
			}
		})
	}
}
