"""Core data models for the agent-verse corporate ecosystem."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class VenturePayload(BaseModel):
    """Standardized enterprise schema for a new micro-business concept (Task 1.2)."""
    company_name: str = Field(description="Kebab-case identifier, e.g. 'pdf-to-podcast-api'")
    core_value_proposition: str
    target_audience: str
    initial_capability_requirements: list[str]
    estimated_token_cost_ceiling_usd: float = 50.0


class OperatorTask(BaseModel):
    """A unit of work assigned to an Operator-Agent."""
    task_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    role: Literal["product", "engineering", "customer-success"]
    description: str
    status: Literal["pending", "in_progress", "completed", "failed", "blocked"] = "pending"
    risk_tier: Literal["low", "medium", "high", "critical"] = "low"
    result: Optional[str] = None
    error: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class TelemetryEntry(BaseModel):
    """Single telemetry record from an operator's Layer 5 (Learning Layer)."""
    entry_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    task_id: str
    agent_role: str
    layer: Literal["sensor", "policy", "tool", "quality_gate", "learning"]
    data: dict[str, Any]
    success: bool
    error: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class PolicyDecision(BaseModel):
    allowed: bool
    risk_tier: Literal["low", "medium", "high", "critical"]
    reason: str
    escalate_to_human: bool = False


class QualityGateResult(BaseModel):
    passed: bool
    issues: list[str] = Field(default_factory=list)
    validated_output: Optional[str] = None


class MonitorReport(BaseModel):
    """Output from the Monitor-Agent self-diagnosis cycle (Tasks 4.1-4.4)."""
    company_id: str
    cycle: int
    friction_points: list[dict[str, Any]]
    diagnosis: str
    mitigation_type: Literal["code_fix", "data_optimization", "skills_update", "none"]
    skills_update: Optional[str] = None
    iteration_complete: bool = False
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class CompanyContext(BaseModel):
    """The 'Company Brain' base context (Task 2.2)."""
    company_id: str
    venture: VenturePayload
    operator_roles: list[str] = ["product", "engineering", "customer-success"]
    token_budget_usd: float = 50.0
    tokens_consumed_usd: float = 0.0
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
