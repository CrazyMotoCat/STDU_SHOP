"""Staging filesystem checks for a private, operator-controlled directory tree."""

import os
import re
import stat
import sys
from pathlib import Path


class UnsafePath(Exception):
    """A staging path cannot be used safely."""


def reparse(info: os.stat_result) -> bool:
    return bool(getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def path_info(path: Path) -> os.stat_result:
    if sys.platform == "win32":
        reject_windows_reparse(path)
    return path.lstat()


def checked_directory(path: Path, *, create: bool = False) -> None:
    if not path.is_absolute() or ".." in path.parts:
        raise UnsafePath
    if sys.platform == "win32" and (
        not re.fullmatch(r"[A-Za-z]:", path.drive)
        or any(os.path.isreserved(part) for part in path.parts[1:])
    ):
        raise UnsafePath
    for part in (*reversed(path.parents), path):
        try:
            info = path_info(part)
        except FileNotFoundError:
            if not create or part == Path(path.anchor):
                raise
            part.mkdir(mode=0o700, exist_ok=True)
            info = path_info(part)
        if reparse(info) or not stat.S_ISDIR(info.st_mode):
            raise UnsafePath


def checked_file(path: Path) -> os.stat_result | None:
    checked_directory(path.parent)
    try:
        info = path_info(path)
    except FileNotFoundError:
        return None
    if reparse(info) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not info.st_ino:
        raise UnsafePath
    return info


def validate_open_file(path: Path, fd: int) -> None:
    info = os.fstat(fd)
    named = checked_file(path)
    if (
        named is None
        or reparse(info)
        or not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or not os.path.samestat(info, named)
    ):
        raise UnsafePath


def open_file(path: Path, *, lock: bool = False) -> int:
    before = checked_file(path)
    if sys.platform == "win32":
        fd = open_windows(path, lock=lock)
    elif sys.platform == "linux" and hasattr(os, "O_NOFOLLOW"):
        flags = os.O_NOFOLLOW | os.O_NONBLOCK
        flags |= os.O_RDWR | os.O_CREAT if lock else os.O_RDONLY
        fd = os.open(path, flags, 0o600)
    else:
        raise UnsafePath
    try:
        validate_open_file(path, fd)
        if before is not None and not os.path.samestat(before, os.fstat(fd)):
            raise UnsafePath
    except BaseException:
        os.close(fd)
        raise
    return fd


if sys.platform == "win32":
    import ctypes
    import msvcrt
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    attributes = kernel.GetFileAttributesW
    attributes.argtypes = [wintypes.LPCWSTR]
    attributes.restype = wintypes.DWORD

    def reject_windows_reparse(path: Path) -> None:
        # CPython lstat alone may resolve non-name-surrogate reparse points.
        flags = attributes(str(path))
        if flags == 0xFFFFFFFF:
            error = ctypes.get_last_error()
            if error in {2, 3}:  # File or path missing.
                raise FileNotFoundError
            raise UnsafePath
        if flags & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise UnsafePath

    def open_windows(path: Path, *, lock: bool) -> int:
        create = kernel.CreateFileW
        create.argtypes = [
            wintypes.LPCWSTR,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.LPVOID,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.HANDLE,
        ]
        create.restype = wintypes.HANDLE
        generic_read, generic_write = 0x80000000, 0x40000000
        share_read_write = 0x3
        open_always, open_existing = 4, 3
        open_reparse_point = 0x00200000
        handle = create(
            str(path),
            generic_read | (generic_write if lock else 0),
            share_read_write,
            None,
            open_always if lock else open_existing,
            open_reparse_point,
            None,
        )
        if handle == wintypes.HANDLE(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return msvcrt.open_osfhandle(handle, os.O_BINARY | (os.O_RDWR if lock else os.O_RDONLY))
        except BaseException:
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel.CloseHandle(handle)
            raise
