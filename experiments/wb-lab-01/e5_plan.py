"""Offline acceptance rules for E5A host sample streams."""

MEMORY_FLOOR = 768 * 1024**2
DISK_FLOOR = 4 * 1024**3
PHASE_BUDGET_MS = {
    "baseline": 5000,
    "controller": 40000,
    "postgres_controller": 40000,
    "recovery": 5000,
}


def host_margins(streams):
    """Accept only complete, timely host streams above existing safety floors."""
    if set(streams) != set(PHASE_BUDGET_MS):
        raise ValueError("E5A_PHASES_INCOMPLETE")
    memory, disk = [], []
    for phase, budget in PHASE_BUDGET_MS.items():
        rows = streams[phase]
        if not 2 <= len(rows) <= 360:
            raise ValueError("E5A_SAMPLE_COUNT")
        previous = -1
        for elapsed, available, free in rows:
            if (
                any(type(value) is not int for value in (elapsed, available, free))
                or not previous < elapsed <= budget
                or elapsed - previous > 501
            ):
                raise ValueError("E5A_SAMPLE_TIME_OR_SHAPE")
            if available < MEMORY_FLOOR or free < DISK_FLOOR:
                raise ValueError("E5A_HOST_WATERMARK")
            memory.append(available)
            disk.append(free)
            previous = elapsed
        if phase in {"baseline", "recovery"} and previous < budget - 500:
            raise ValueError("E5A_IDLE_SAMPLE_WINDOW")
    return {
        "minimum_available_bytes": min(memory),
        "memory_margin_bytes": min(memory) - MEMORY_FLOOR,
        "minimum_disk_free_bytes": min(disk),
        "disk_margin_bytes": min(disk) - DISK_FLOOR,
    }
