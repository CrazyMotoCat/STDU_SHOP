"""Addressed cleanup tests. No Docker daemon is contacted."""

import unittest

from e5a_ownership import Resource, cleanup
from preflight import LABEL, Blocked

RUN = "a" * 32
PREFIX = f"wb-lab-01-e5a-{RUN}-"
CONTAINER = Resource("container", PREFIX + "controller", "b" * 64)
VOLUME = Resource(
    "volume", PREFIX + "media", created_at="timestamp", mountpoint="/owned"
)


class Engine:
    def __init__(self):
        self.container = {
            "Id": CONTAINER.identifier,
            "Name": "/" + CONTAINER.name,
            "Config": {"Labels": {LABEL: RUN}},
        }
        self.volume = {
            "Name": VOLUME.name,
            "Labels": {LABEL: RUN},
            "Driver": "local",
            "Scope": "local",
            "Options": None,
            "CreatedAt": VOLUME.created_at,
            "Mountpoint": VOLUME.mountpoint,
        }
        self.attached = ""
        self.removed = []

    def inspect(self, deadline, kind, ref):
        if kind == "container":
            assert ref in (CONTAINER.identifier, CONTAINER.name)
            return self.container
        assert ref == VOLUME.name
        return self.volume

    def checked(self, deadline, kind, operation, *args):
        if operation == "ls":
            return self.attached
        assert operation == "rm"
        self.removed.append(args[-1])
        setattr(self, kind, None)


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine()

    def cleanup(self, resources=(CONTAINER, VOLUME)):
        cleanup(10, RUN, resources, lambda _: None, engine=self.engine)

    def test_exact_writer_id_removed_before_volume(self):
        self.cleanup()
        self.assertEqual(self.engine.removed, [CONTAINER.identifier, VOLUME.name])

    def test_lost_create_response_recovers_exact_container_id(self):
        self.cleanup((Resource("container", CONTAINER.name), VOLUME))
        self.assertEqual(self.engine.removed[0], CONTAINER.identifier)

    def test_unknown_resource_retains_everything(self):
        for field in ("Labels", "CreatedAt"):
            with self.subTest(field=field):
                self.engine = Engine()
                self.engine.volume[field] = {}
                with self.assertRaises(Blocked):
                    self.cleanup()
                self.assertEqual(self.engine.removed, [])

    def test_foreign_attachment_prevents_volume_removal(self):
        self.engine.attached = "foreign"
        with self.assertRaisesRegex(Blocked, "E5A_VOLUME_ATTACHED"):
            self.cleanup()
        self.assertEqual(self.engine.removed, [CONTAINER.identifier])

    def test_lost_create_and_unconfirmed_absence_does_not_retry(self):
        self.engine.container = None
        with self.assertRaisesRegex(Blocked, "E5A_CREATE_UNCONFIRMED"):
            self.cleanup((Resource("container", CONTAINER.name), VOLUME))
        self.assertEqual(self.engine.removed, [])
