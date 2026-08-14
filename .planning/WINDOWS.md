---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-08-14T01:23:00.785Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 34 | deviation | packages/database/src/pool-manager.test.ts |  | Pre-existing mock.module('postgres',...) global pollution (same class as STATE.md's Known Pitfalls entry) makes seed-idempotency.test.ts and agents.integration.test.ts fail when the FULL 'bun test' runs in one process alongside pool-manager.test.ts; both pass 100% when run via 'bun test src/__tests__/integration' in isolation. Reproduced on unmodified master before this plan's changes -- not caused by 34-02. See .planning/todos/pending/2026-08-14-fix-pool-manager-mock-module-pollution-in-database-full-suite.md | open |  | 2026-08-14T01:23:00.785Z |  |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "34",
    "file": "packages/database/src/pool-manager.test.ts",
    "line": null,
    "description": "Pre-existing mock.module('postgres',...) global pollution (same class as STATE.md's Known Pitfalls entry) makes seed-idempotency.test.ts and agents.integration.test.ts fail when the FULL 'bun test' runs in one process alongside pool-manager.test.ts; both pass 100% when run via 'bun test src/__tests__/integration' in isolation. Reproduced on unmodified master before this plan's changes -- not caused by 34-02. See .planning/todos/pending/2026-08-14-fix-pool-manager-mock-module-pollution-in-database-full-suite.md",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-14T01:23:00.785Z",
    "resolved_at": null
  }
]
````
