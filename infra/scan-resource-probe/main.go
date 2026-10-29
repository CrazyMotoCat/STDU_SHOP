package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const minScratch = uint64(384 * 1024 * 1024)
const scratchSize = uint64(512 * 1024 * 1024)

var uuidPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var errScratch = errors.New("SCRATCH_UNAVAILABLE")
var errCgroup = errors.New("CGROUP_UNAVAILABLE")
var errOOM = errors.New("OOM_DETECTED")
var errScanner = errors.New("SCANNER_UNAVAILABLE")
var errConfig = errors.New("CONFIGURATION_ERROR")

type snapshot struct {
	Ready                 bool   `json:"ready"`
	Instance              string `json:"instance"`
	MeasuredAt            int64  `json:"measuredAt"`
	ScratchAvailableBytes uint64 `json:"scratchAvailableBytes"`
	OOM                   uint64 `json:"oom"`
	OOMKill               uint64 `json:"oomKill"`
}

func scratchAvailable(fs syscall.Statfs_t) (uint64, error) {
	available := fs.Bavail * uint64(fs.Bsize)
	if fs.Blocks*uint64(fs.Bsize) != scratchSize || available < minScratch || fs.Ffree == 0 {
		return 0, errScratch
	}
	return available, nil
}

func counters(text string) (uint64, uint64, error) {
	values := map[string]uint64{}
	for _, line := range strings.Split(strings.TrimSpace(text), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			return 0, 0, errCgroup
		}
		if _, exists := values[fields[0]]; exists {
			return 0, 0, errCgroup
		}
		n, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return 0, 0, errCgroup
		}
		values[fields[0]] = n
	}
	oom, a := values["oom"]
	killed, b := values["oom_kill"]
	if !a || !b {
		return 0, 0, errCgroup
	}
	if oom != 0 || killed != 0 || values["oom_group_kill"] != 0 {
		return 0, 0, errOOM
	}
	return oom, killed, nil
}

func scannerIdentity() (string, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return "", err
	}
	var identities []string
	for _, entry := range entries {
		pid := entry.Name()
		if _, err := strconv.ParseUint(pid, 10, 32); err != nil {
			continue
		}
		comm, err := os.ReadFile("/proc/" + pid + "/comm")
		if err != nil || strings.TrimSpace(string(comm)) != "clamd" {
			continue
		}
		data, err := os.ReadFile("/proc/" + pid + "/stat")
		if err != nil {
			continue
		}
		s := string(data)
		end := strings.LastIndex(s, ")")
		if end < 0 {
			continue
		}
		fields := strings.Fields(s[end+1:])
		if len(fields) <= 19 {
			continue
		}
		if _, err := strconv.ParseUint(fields[19], 10, 64); err != nil {
			continue
		}
		identities = append(identities, pid+":"+fields[19])
	}
	if len(identities) != 1 {
		return "", errScanner
	}
	return identities[0], nil
}

func measure(instance string) (snapshot, error) {
	var out snapshot
	config, err := os.ReadFile("/etc/clamav/clamd.conf")
	if err != nil || !regexp.MustCompile(`(?m)^TemporaryDirectory\s+/tmp\s*$`).Match(config) {
		return out, errConfig
	}
	mounts, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil || !regexp.MustCompile(`(?m)^\S+ \S+ \S+ \S+ /tmp \S+ (.* )?- tmpfs `).Match(mounts) {
		return out, errScratch
	}
	var fs syscall.Statfs_t
	if err := syscall.Statfs("/tmp", &fs); err != nil {
		return out, errScratch
	}
	available, err := scratchAvailable(fs)
	if err != nil {
		return out, err
	}
	group, err := os.ReadFile("/proc/self/cgroup")
	if err != nil || strings.TrimSpace(string(group)) != "0::/" {
		return out, errCgroup
	}
	events, err := os.ReadFile("/sys/fs/cgroup/memory.events.local")
	if err != nil {
		return out, errCgroup
	}
	oom, killed, err := counters(string(events))
	if err != nil {
		return out, err
	}
	scanner, err := scannerIdentity()
	if err != nil {
		return out, err
	}
	return snapshot{true, instance + ":" + scanner, time.Now().UnixMilli(), available, oom, killed}, nil
}

func main() {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		panic(err)
	}
	raw := hex.EncodeToString(bytes)
	if !uuidPattern.MatchString(raw) {
		panic("instance")
	}
	instance := fmt.Sprintf("%s-%s-%s-%s-%s", raw[:8], raw[8:12], raw[12:16], raw[16:20], raw[20:])
	bind := os.Getenv("SCAN_RESOURCE_BIND")
	if bind == "" {
		panic("missing bind")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/ready" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		result, err := measure(instance)
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			reason := "SCANNER_UNAVAILABLE"
			for _, known := range []error{errScratch, errCgroup, errOOM, errScanner, errConfig} {
				if errors.Is(err, known) {
					reason = known.Error()
					break
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ready": false, "reason": reason})
			return
		}
		_ = json.NewEncoder(w).Encode(result)
	})
	server := &http.Server{Addr: bind + ":3311", Handler: mux, ReadHeaderTimeout: 2 * time.Second, WriteTimeout: 3 * time.Second, IdleTimeout: 3 * time.Second, MaxHeaderBytes: 4096}
	if err := server.ListenAndServe(); err != nil {
		panic("resource probe unavailable")
	}
}
