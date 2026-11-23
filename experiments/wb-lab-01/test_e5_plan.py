import unittest

from e5_plan import DISK_FLOOR, MEMORY_FLOOR, PHASE_BUDGET_MS, host_margins


class E5PlanTests(unittest.TestCase):
    def setUp(self):
        self.streams = {
            phase: [
                (ms, MEMORY_FLOOR + 32, DISK_FLOOR + 64)
                for ms in range(0, limit + 1, 250)
            ]
            for phase, limit in PHASE_BUDGET_MS.items()
        }

    def test_sample_minimum_is_not_the_sum_of_limits(self):
        self.streams["controller"][3] = (750, MEMORY_FLOOR + 1, DISK_FLOOR + 2)
        result = host_margins(self.streams)
        self.assertEqual(result["memory_margin_bytes"], 1)
        self.assertEqual(result["disk_margin_bytes"], 2)

    def test_transient_low_memory_or_disk_blocks(self):
        for memory, disk in (
            (MEMORY_FLOOR - 1, DISK_FLOOR),
            (MEMORY_FLOOR, DISK_FLOOR - 1),
        ):
            with self.subTest(memory=memory, disk=disk):
                self.streams["controller"][3] = (750, memory, disk)
                with self.assertRaisesRegex(ValueError, "E5A_HOST_WATERMARK"):
                    host_margins(self.streams)

    def test_missing_phase_or_sampling_gap_blocks(self):
        self.streams["controller"][3:5] = []
        with self.assertRaisesRegex(ValueError, "E5A_SAMPLE_TIME_OR_SHAPE"):
            host_margins(self.streams)
        del self.streams["controller"]
        with self.assertRaisesRegex(ValueError, "E5A_PHASES_INCOMPLETE"):
            host_margins(self.streams)

    def test_short_recovery_window_blocks(self):
        self.streams["recovery"] = self.streams["recovery"][:5]
        with self.assertRaisesRegex(ValueError, "E5A_IDLE_SAMPLE_WINDOW"):
            host_margins(self.streams)
