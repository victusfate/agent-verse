"""Total Legibility Layer — append-only SQLite event ledger (Core Constraint 1)."""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).parent.parent / "companies" / "ledger.db"


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_ledger() -> None:
    """Create the append-only events table if it doesn't exist."""
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id    TEXT    NOT NULL UNIQUE,
                company_id  TEXT    NOT NULL,
                event_type  TEXT    NOT NULL,
                agent_type  TEXT,
                payload     TEXT    NOT NULL,
                created_at  TEXT    NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_company ON events(company_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_type    ON events(event_type)")
        conn.commit()


def record(
    company_id: str,
    event_type: str,
    payload: dict[str, Any],
    agent_type: str | None = None,
) -> str:
    """Append an immutable event to the ledger. Returns the event_id."""
    event_id = str(uuid.uuid4())
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO events (event_id, company_id, event_type, agent_type, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                company_id,
                event_type,
                agent_type,
                json.dumps(payload),
                datetime.utcnow().isoformat(),
            ),
        )
        conn.commit()
    return event_id


def query(
    company_id: str,
    event_type: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Read events for a company, newest-last."""
    with _connect() as conn:
        if event_type:
            rows = conn.execute(
                "SELECT * FROM events WHERE company_id=? AND event_type=? ORDER BY id LIMIT ?",
                (company_id, event_type, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM events WHERE company_id=? ORDER BY id LIMIT ?",
                (company_id, limit),
            ).fetchall()
    result = []
    for row in rows:
        entry = dict(row)
        entry["payload"] = json.loads(entry["payload"])
        result.append(entry)
    return result


def query_failures(company_id: str) -> list[dict[str, Any]]:
    """Return all telemetry entries where success=False."""
    rows = query(company_id, event_type="telemetry")
    return [r for r in rows if not r["payload"].get("success", True)]
