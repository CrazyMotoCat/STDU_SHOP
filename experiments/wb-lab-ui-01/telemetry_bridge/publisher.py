"""Optional MQTT 3.1.1 transport for the synthetic DEMO publisher."""

from __future__ import annotations

import threading
import time
from typing import Any

from .contract import BASE_TOPIC, demo_frame, mqtt_messages


class DemoMqttPublisher:
    """Publishes allowlisted demo values; it never subscribes or emits command topics."""

    def __init__(
        self,
        host: str,
        port: int = 1883,
        *,
        username: str | None = None,
        password: str | None = None,
        tls: bool = False,
        timeout_seconds: float = 10,
    ) -> None:
        if not host.strip():
            raise ValueError("MQTT host is required")
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.tls = tls
        self.timeout_seconds = timeout_seconds
        self.client: Any = None
        self._connected = threading.Event()
        self._connect_error: str | None = None

    def connect(self) -> None:
        try:
            import paho.mqtt.client as mqtt
        except ImportError as exc:
            raise RuntimeError("MQTT publishing requires paho-mqtt from requirements.txt") from exc

        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id="stdu-wb-lab-ui-01-demo",
            protocol=mqtt.MQTTv311,
        )
        if self.username is not None:
            client.username_pw_set(self.username, self.password or "")
        if self.tls:
            client.tls_set()
        client.will_set(f"{BASE_TOPIC}/controls/Collector_Status", "OFFLINE", qos=1, retain=True)

        def on_connect(_client, _userdata, _flags, reason_code, _properties) -> None:
            if reason_code != 0:
                self._connect_error = "MQTT broker rejected the connection"
            self._connected.set()

        client.on_connect = on_connect
        client.connect(self.host, self.port, keepalive=30)
        client.loop_start()
        self.client = client
        if not self._connected.wait(self.timeout_seconds):
            self.close()
            raise TimeoutError("Timed out waiting for the MQTT connection")
        if self._connect_error:
            self.close()
            raise ConnectionError(self._connect_error)

    def publish_step(self, step: int) -> None:
        if self.client is None or not self._connected.is_set():
            raise RuntimeError("MQTT publisher is not connected")
        self._publish_messages(mqtt_messages(demo_frame(step, collector_connected=True)))

    def _publish_messages(self, messages: list[tuple[str, str, bool]]) -> None:
        for topic, payload, retained in messages:
            info = self.client.publish(topic, payload, qos=0, retain=retained)
            info.wait_for_publish(timeout=5)
            if not info.is_published():
                raise TimeoutError("An MQTT telemetry publish did not complete")

    def close(self) -> None:
        if self.client is None:
            return
        try:
            offline = self.client.publish(
                f"{BASE_TOPIC}/controls/Collector_Status", "OFFLINE", qos=1, retain=True
            )
            offline.wait_for_publish(timeout=3)
            self.client.disconnect()
        finally:
            self.client.loop_stop()
            self.client = None
            self._connected.clear()

    def run(self, *, steps: int, interval_seconds: float) -> None:
        if steps < 1:
            raise ValueError("steps must be at least one")
        if interval_seconds < 0.2:
            raise ValueError("interval must be at least 0.2 seconds")
        self.connect()
        try:
            for step in range(steps):
                self.publish_step(step)
                if step + 1 < steps:
                    time.sleep(interval_seconds)
        finally:
            self.close()
