"""Tiny persistent job queue: background work with live progress + logs.

The Colab blocks the browser tab while a cell runs and loses everything on
disconnect. Here jobs run in worker threads, stream progress, and survive page
reloads because state is written to disk.
"""
from __future__ import annotations

import json
import queue
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .config import JOBS_DIR, MAX_WORKERS


@dataclass
class Job:
    id: str
    kind: str
    title: str
    status: str = "queued"        # queued | running | done | error | cancelled
    progress: float = 0.0
    message: str = "Queued"
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    result: Dict[str, Any] = field(default_factory=dict)
    error: str = ""
    log: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["log"] = self.log[-200:]
        d["elapsed"] = round((self.finished_at or time.time()) - (self.started_at or self.created_at), 1)
        return d


class JobManager:
    def __init__(self, workers: int = MAX_WORKERS) -> None:
        self._jobs: Dict[str, Job] = {}
        self._cancel: Dict[str, bool] = {}
        self._q: "queue.Queue[tuple[str, Callable]]" = queue.Queue()
        self._lock = threading.Lock()
        self._threads = [
            threading.Thread(target=self._worker, daemon=True, name=f"rvc-worker-{i}")
            for i in range(max(1, workers))
        ]
        for t in self._threads:
            t.start()

    # ---------------------------------------------------------------- public
    def submit(self, kind: str, title: str, fn: Callable[["JobHandle"], Dict]) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], kind=kind, title=title)
        with self._lock:
            self._jobs[job.id] = job
        self._persist(job)
        self._q.put((job.id, fn))
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            job = self._jobs.get(job_id)
        if job:
            return job
        f = JOBS_DIR / f"{job_id}.json"
        if f.exists():
            try:
                return Job(**{k: v for k, v in json.loads(f.read_text()).items()
                              if k in Job.__annotations__})
            except Exception:
                return None
        return None

    def list(self, limit: int = 50) -> List[Dict]:
        with self._lock:
            jobs = sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)
        return [j.to_dict() for j in jobs[:limit]]

    def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if not job or job.status in ("done", "error", "cancelled"):
            return False
        self._cancel[job_id] = True
        if job.status == "queued":
            job.status = "cancelled"
            job.message = "Cancelled before start"
            job.finished_at = time.time()
            self._persist(job)
        return True

    def clear_finished(self) -> int:
        with self._lock:
            done = [j for j in self._jobs.values()
                    if j.status in ("done", "error", "cancelled")]
            for j in done:
                self._jobs.pop(j.id, None)
                (JOBS_DIR / f"{j.id}.json").unlink(missing_ok=True)
        return len(done)

    # --------------------------------------------------------------- internal
    def _persist(self, job: Job) -> None:
        try:
            (JOBS_DIR / f"{job.id}.json").write_text(json.dumps(job.to_dict(), indent=2))
        except Exception:
            pass

    def _worker(self) -> None:
        while True:
            job_id, fn = self._q.get()
            job = self.get(job_id)
            if job is None or self._cancel.get(job_id):
                self._q.task_done()
                continue
            job.status, job.started_at = "running", time.time()
            job.message = "Starting"
            self._persist(job)
            handle = JobHandle(self, job)
            try:
                job.result = fn(handle) or {}
                if self._cancel.get(job_id):
                    job.status, job.message = "cancelled", "Cancelled"
                else:
                    job.status, job.progress, job.message = "done", 1.0, "Completed"
            except CancelledError:
                job.status, job.message = "cancelled", "Cancelled"
            except Exception as exc:
                job.status = "error"
                job.error = f"{exc.__class__.__name__}: {exc}"
                job.message = "Failed"
                handle.log(traceback.format_exc().strip().splitlines()[-1])
            finally:
                job.finished_at = time.time()
                self._persist(job)
                self._cancel.pop(job_id, None)
                self._q.task_done()


class CancelledError(Exception):
    pass


class JobHandle:
    """Passed to job functions: report progress, log lines, honour cancellation."""

    def __init__(self, mgr: JobManager, job: Job) -> None:
        self._mgr, self._job = mgr, job
        self._last_persist = 0.0

    @property
    def job(self) -> Job:
        return self._job

    def check_cancel(self) -> None:
        if self._mgr._cancel.get(self._job.id):
            raise CancelledError()

    def progress(self, value: float, message: str = "") -> None:
        self.check_cancel()
        self._job.progress = max(0.0, min(1.0, float(value)))
        if message:
            self._job.message = message
            if not self._job.log or self._job.log[-1].split("] ", 1)[-1] != message:
                self.log(message)
        now = time.time()
        if now - self._last_persist > 0.4:
            self._last_persist = now
            self._mgr._persist(self._job)

    def log(self, line: str) -> None:
        stamp = time.strftime("%H:%M:%S")
        self._job.log.append(f"[{stamp}] {line}")
        if len(self._job.log) > 2000:
            del self._job.log[:1000]


MANAGER = JobManager()
