"""Run the preparatory model suite without contacting Docker or PostgreSQL."""

import json
import sys
import unittest
from datetime import UTC, datetime
from pathlib import Path

if __name__ == "__main__":
    suite = unittest.defaultTestLoader.discover(
        str(Path(__file__).parent), pattern="test_models.py"
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(
        json.dumps(
            {
                "schema": 1,
                "recorded_at": datetime.now(UTC).isoformat(),
                "evidence_kind": "MOCK_ONLY",
                "model_tests": result.testsRun,
                "model_status": "PASS" if result.wasSuccessful() else "FAIL",
                "runtime_experiments": {
                    "E0": "NOT_RUN",
                    "E1": "NOT_RUN",
                    "E2": "NOT_RUN",
                    "E3": "NOT_RUN",
                    "E3b": "NOT_RUN",
                    "E4a": "NOT_RUN",
                    "E4b": "BLOCKED",
                    "E5": "NOT_RUN",
                },
                "target_filesystem_match": "NOT_PROVEN",
                "prerequisite": "Owner-designated prepared Linux/ext4 test host",
            },
            indent=2,
        )
    )
    sys.exit(0 if result.wasSuccessful() else 1)
