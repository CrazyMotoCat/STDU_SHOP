"""Windows-only owned process boundary. Protocol on stdin/stdout; app logs on stderr.

PROC_THREAD_ATTRIBUTE_JOB_LIST assigns the job during CreateProcess, before any
child code runs. KILL_ON_JOB_CLOSE also covers helper/parent death. Python stdlib
only; no shell, process-name lookup, port lookup or unowned PID termination.
"""

import ctypes as c
import json
import os
import signal
import subprocess
import sys
import time
from ctypes import wintypes as w


class Startup(c.Structure):
    _fields_ = [
        ("cb", w.DWORD),
        ("reserved", w.LPWSTR),
        ("desktop", w.LPWSTR),
        ("title", w.LPWSTR),
        ("x", w.DWORD),
        ("y", w.DWORD),
        ("xsize", w.DWORD),
        ("ysize", w.DWORD),
        ("xchars", w.DWORD),
        ("ychars", w.DWORD),
        ("fill", w.DWORD),
        ("flags", w.DWORD),
        ("show", w.WORD),
        ("reserved_size", w.WORD),
        ("reserved2", c.c_void_p),
        ("stdin", w.HANDLE),
        ("stdout", w.HANDLE),
        ("stderr", w.HANDLE),
    ]


class StartupEx(c.Structure):
    _fields_ = [("info", Startup), ("attributes", c.c_void_p)]


class ProcessInfo(c.Structure):
    _fields_ = [
        ("process", w.HANDLE),
        ("thread", w.HANDLE),
        ("pid", w.DWORD),
        ("tid", w.DWORD),
    ]


class BasicLimits(c.Structure):
    _fields_ = [
        ("process_time", c.c_longlong),
        ("job_time", c.c_longlong),
        ("flags", w.DWORD),
        ("min_ws", c.c_size_t),
        ("max_ws", c.c_size_t),
        ("active_limit", w.DWORD),
        ("affinity", c.c_size_t),
        ("priority", w.DWORD),
        ("scheduling", w.DWORD),
    ]


class Limits(c.Structure):
    _fields_ = [
        ("basic", BasicLimits),
        ("io", c.c_ulonglong * 6),
        ("process_memory", c.c_size_t),
        ("job_memory", c.c_size_t),
        ("peak_process", c.c_size_t),
        ("peak_job", c.c_size_t),
    ]


class Accounting(c.Structure):
    _fields_ = [
        ("times", c.c_longlong * 4),
        ("faults", w.DWORD),
        ("total", w.DWORD),
        ("active", w.DWORD),
        ("terminated", w.DWORD),
    ]


def emit(**event):
    print(json.dumps(event), flush=True)


def main():
    import msvcrt

    signal.signal(signal.SIGINT, signal.SIG_IGN)  # Parent owns Ctrl+C cleanup.

    kernel = c.WinDLL("kernel32", use_last_error=True)
    signatures = {
        "CreateJobObjectW": ([c.c_void_p, w.LPCWSTR], w.HANDLE),
        "SetInformationJobObject": ([w.HANDLE, c.c_int, c.c_void_p, w.DWORD], w.BOOL),
        "QueryInformationJobObject": (
            [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p],
            w.BOOL,
        ),
        "TerminateJobObject": ([w.HANDLE, w.UINT], w.BOOL),
        "CloseHandle": ([w.HANDLE], w.BOOL),
        "InitializeProcThreadAttributeList": (
            [c.c_void_p, w.DWORD, w.DWORD, c.c_void_p],
            w.BOOL,
        ),
        "UpdateProcThreadAttribute": (
            [
                c.c_void_p,
                w.DWORD,
                c.c_size_t,
                c.c_void_p,
                c.c_size_t,
                c.c_void_p,
                c.c_void_p,
            ],
            w.BOOL,
        ),
        "DeleteProcThreadAttributeList": ([c.c_void_p], None),
        "CreateProcessW": (
            [
                w.LPCWSTR,
                w.LPWSTR,
                c.c_void_p,
                c.c_void_p,
                w.BOOL,
                w.DWORD,
                c.c_void_p,
                w.LPCWSTR,
                c.POINTER(StartupEx),
                c.POINTER(ProcessInfo),
            ],
            w.BOOL,
        ),
        "WaitForSingleObject": ([w.HANDLE, w.DWORD], w.DWORD),
        "GetExitCodeProcess": ([w.HANDLE, c.POINTER(w.DWORD)], w.BOOL),
        "GenerateConsoleCtrlEvent": ([w.DWORD, w.DWORD], w.BOOL),
        "GetConsoleWindow": ([], w.HWND),
        "PeekNamedPipe": (
            [w.HANDLE, c.c_void_p, w.DWORD, c.c_void_p, c.POINTER(w.DWORD), c.c_void_p],
            w.BOOL,
        ),
    }
    for name, (arguments, result) in signatures.items():
        getattr(kernel, name).argtypes = arguments
        getattr(kernel, name).restype = result

    def checked(ok):
        if not ok:
            raise c.WinError(c.get_last_error())

    def launch(spec, job):
        limits = Limits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        checked(
            kernel.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits))
        )
        size = c.c_size_t()
        kernel.InitializeProcThreadAttributeList(None, 2, 0, c.byref(size))
        attributes = c.create_string_buffer(size.value)
        checked(
            kernel.InitializeProcThreadAttributeList(attributes, 2, 0, c.byref(size))
        )
        try:
            jobs = (w.HANDLE * 1)(job)
            checked(
                kernel.UpdateProcThreadAttribute(
                    attributes, 0, 0x2000D, jobs, c.sizeof(jobs), None, None
                )
            )
            with open(os.devnull, "rb") as null:
                input_handle = msvcrt.get_osfhandle(null.fileno())
                output_handle = msvcrt.get_osfhandle(sys.stderr.fileno())
                handles = (w.HANDLE * 2)(input_handle, output_handle)
                raw_handles = [input_handle, output_handle]
                previous = [os.get_handle_inheritable(handle) for handle in raw_handles]
                try:
                    for handle in raw_handles:
                        os.set_handle_inheritable(handle, True)
                    checked(
                        kernel.UpdateProcThreadAttribute(
                            attributes,
                            0,
                            0x20002,
                            handles,
                            c.sizeof(handles),
                            None,
                            None,
                        )
                    )
                    startup = StartupEx()
                    startup.info.cb = c.sizeof(startup)
                    startup.info.flags = 0x100  # STARTF_USESTDHANDLES
                    startup.info.stdin = input_handle
                    startup.info.stdout = startup.info.stderr = output_handle
                    startup.attributes = c.cast(attributes, c.c_void_p)
                    info = ProcessInfo()
                    command = c.create_unicode_buffer(
                        subprocess.list2cmdline([spec["command"], *spec["args"]])
                    )
                    flags = (
                        0x80000 | 0x200
                    )  # EXTENDED_STARTUPINFO_PRESENT | NEW_PROCESS_GROUP
                    if not kernel.GetConsoleWindow():
                        flags |= (
                            0x08000000  # CREATE_NO_WINDOW: no hidden console popups
                        )
                    checked(
                        kernel.CreateProcessW(
                            spec["command"],
                            command,
                            None,
                            None,
                            True,
                            flags,
                            None,
                            spec["cwd"],
                            c.byref(startup),
                            c.byref(info),
                        )
                    )
                    kernel.CloseHandle(info.thread)
                    return info
                finally:
                    for handle, inherited in zip(raw_handles, previous, strict=True):
                        os.set_handle_inheritable(handle, inherited)
        finally:
            kernel.DeleteProcThreadAttributeList(attributes)

    job = kernel.CreateJobObjectW(None, None)
    checked(job)
    info = None
    pending = b""
    last_active = None
    exited = False
    input_handle = msvcrt.get_osfhandle(sys.stdin.fileno())
    try:
        while True:
            available = w.DWORD()
            if not kernel.PeekNamedPipe(
                input_handle, None, 0, None, c.byref(available), None
            ):
                return 1  # Parent/pipe gone: closing job kills every owned descendant.
            if available.value:
                data = os.read(sys.stdin.fileno(), available.value)
                if not data:
                    return 1
                pending += data
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                message = json.loads(line)
                if info is None:
                    info = launch(message, job)
                    emit(event="started", pid=info.pid)
                elif message["action"] == "stop":
                    # Console event may be unavailable in headless Windows. The
                    # job remains intact until the bounded force phase.
                    delivered = kernel.WaitForSingleObject(
                        info.process, 0
                    ) == 258 and bool(kernel.GenerateConsoleCtrlEvent(1, info.pid))
                    emit(event="signal", delivered=delivered)
                elif message["action"] == "kill":
                    checked(kernel.TerminateJobObject(job, 1))
                elif message["action"] == "close":
                    count = Accounting()
                    checked(
                        kernel.QueryInformationJobObject(
                            job, 1, c.byref(count), c.sizeof(count), None
                        )
                    )
                    if count.active:
                        raise RuntimeError(
                            "Refusing successful close of a nonempty job"
                        )
                    return 0
            if info is not None:
                count = Accounting()
                checked(
                    kernel.QueryInformationJobObject(
                        job, 1, c.byref(count), c.sizeof(count), None
                    )
                )
                if last_active != count.active:
                    emit(event="active", count=count.active)
                    last_active = count.active
                if not exited and kernel.WaitForSingleObject(info.process, 0) == 0:
                    code = w.DWORD()
                    checked(kernel.GetExitCodeProcess(info.process, c.byref(code)))
                    emit(event="exit", code=code.value)
                    exited = True
            time.sleep(0.025)
    finally:
        kernel.CloseHandle(job)
        if info is not None:
            kernel.CloseHandle(info.process)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, RuntimeError, TypeError):
        # Win32 error details/launch arguments may contain secrets. Report only
        # the class; the supervisor identifies its own named process boundary.
        emit(event="error", reason="Windows job initialization/control failed")
        sys.exit(1)
