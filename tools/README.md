# Tools — Capability Index

Standalone executables that operate on or export this repo's capabilities.
Each tool directory contains `tool.yaml` (descriptor), `run` (entry), `test`, and a README.

| Tool | Purpose |
|---|---|
| [hoist-skill](hoist-skill/) | Emit scaffold capabilities (skills, rules, workflows) into a consumer repo in the target harness format. Supports `--plan`, `--fetch`, and manifest-pinned syncs. |

`lib/` holds modules shared by tools (e.g. `safe-write.mjs`).

The former `capability-export` tool was an early subset of `hoist-skill` and has been removed — use `hoist-skill` for all exports.
