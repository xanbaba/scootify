import os
import sqlite3
from collections.abc import Iterator
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator

from .campus import Coordinate
from .routing import MapPoint


Category = Literal["pothole", "debris", "blocked_path", "slippery", "other"]
Vote = Literal["still_there", "looks_clear"]
DB_PATH = Path(os.environ.get("SCOOTIFY_DB_PATH", Path(__file__).with_name("data") / "scootify.sqlite3"))
REPORT_PATH_RADIUS_M = 40

SCHEMA = """
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    segment_id TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS report_votes (
    report_id TEXT NOT NULL REFERENCES reports(id),
    rider_id TEXT NOT NULL,
    vote TEXT NOT NULL CHECK(vote IN ('still_there', 'looks_clear')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (report_id, rider_id)
);
"""

REPORT_QUERY = """
SELECT reports.*,
       COUNT(CASE WHEN votes.vote = 'still_there' THEN 1 END) AS still_there,
       COUNT(CASE WHEN votes.vote = 'looks_clear' THEN 1 END) AS looks_clear,
       MAX(CASE WHEN votes.vote = 'still_there' THEN votes.updated_at END) AS last_confirmed_at
FROM reports
LEFT JOIN report_votes AS votes ON votes.report_id = reports.id
"""


class ReportDraft(BaseModel):
    segment_id: str = Field(min_length=1, max_length=160)
    category: Category
    description: str = Field(default="", max_length=280)
    point: MapPoint

    @field_validator("description")
    @classmethod
    def trim_description(cls, value: str) -> str:
        return value.strip()


class ReportPath(BaseModel):
    segment_id: str
    name: str
    geometry: list[Coordinate]
    point: Coordinate
    distance_m: float
    modes: list[Literal["walk", "bike"]]


class Report(BaseModel):
    id: UUID
    segment_id: str
    category: Category
    description: str
    latitude: float
    longitude: float
    created_at: datetime
    resolved_at: datetime | None
    still_there: int
    looks_clear: int
    last_confirmed_at: datetime | None


class ReportVote(BaseModel):
    rider_id: UUID
    vote: Vote


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


class ReportStore:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        with closing(sqlite3.connect(self.path)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            with connection:
                yield connection

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(SCHEMA)

    def list_reports(self, *, include_resolved: bool = False) -> list[Report]:
        where = "" if include_resolved else "WHERE reports.resolved_at IS NULL"
        with self.connect() as connection:
            rows = connection.execute(f"""
                {REPORT_QUERY}
                {where}
                GROUP BY reports.id
                ORDER BY reports.created_at DESC, reports.id
            """)
            return [Report.model_validate(dict(row)) for row in rows]

    def get(self, connection: sqlite3.Connection, report_id: UUID) -> Report | None:
        row = connection.execute(f"""
            {REPORT_QUERY}
            WHERE reports.id = ?
            GROUP BY reports.id
        """, (str(report_id),)).fetchone()
        return Report.model_validate(dict(row)) if row else None

    def create(self, draft: ReportDraft, point: Coordinate) -> Report:
        report_id = uuid4()
        with self.connect() as connection:
            connection.execute("""
                INSERT INTO reports (id, segment_id, category, description, latitude, longitude, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (str(report_id), draft.segment_id, draft.category, draft.description, *point, timestamp()))
            report = self.get(connection, report_id)
            assert report is not None
            return report

    def vote(self, report_id: UUID, vote: ReportVote) -> Report | None:
        with self.connect() as connection:
            # Check the report and update the vote in one write transaction.
            result = connection.execute("""
                INSERT INTO report_votes (report_id, rider_id, vote, updated_at)
                SELECT id, ?, ?, ? FROM reports WHERE id = ? AND resolved_at IS NULL
                ON CONFLICT(report_id, rider_id) DO UPDATE SET
                    vote = excluded.vote, updated_at = excluded.updated_at
            """, (str(vote.rider_id), vote.vote, timestamp(), str(report_id)))
            return self.get(connection, report_id) if result.rowcount else None

    def resolve(self, report_id: UUID) -> Report | None:
        with self.connect() as connection:
            connection.execute("""
                UPDATE reports SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL
            """, (timestamp(), str(report_id)))
            return self.get(connection, report_id)
