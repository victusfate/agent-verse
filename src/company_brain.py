"""Ephemeral Software Layer — manages the 'Company Brain' files (Core Constraint 2).

The primary assets are context_framework.json and skills.md.
All application code is considered disposable; the brain files are not.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

COMPANIES_DIR = Path(__file__).parent.parent / "companies"


def company_dir(company_id: str) -> Path:
    d = COMPANIES_DIR / company_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_context_framework(company_id: str, context: dict[str, Any]) -> Path:
    path = company_dir(company_id) / "context_framework.json"
    path.write_text(json.dumps(context, indent=2))
    return path


def read_context_framework(company_id: str) -> dict[str, Any]:
    path = company_dir(company_id) / "context_framework.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def write_skills(company_id: str, content: str) -> Path:
    path = company_dir(company_id) / "skills.md"
    path.write_text(content)
    return path


def read_skills(company_id: str) -> str:
    path = company_dir(company_id) / "skills.md"
    if not path.exists():
        return ""
    return path.read_text()


def append_task_log(company_id: str, task_id: str, data: dict[str, Any]) -> None:
    tasks_dir = company_dir(company_id) / "tasks"
    tasks_dir.mkdir(exist_ok=True)
    path = tasks_dir / f"{task_id}.json"
    path.write_text(json.dumps(data, indent=2))
