package main

import (
	"syscall"
	"testing"
)

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
