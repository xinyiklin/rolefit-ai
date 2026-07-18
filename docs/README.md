# Workspace Documentation

Use the narrowest document that owns the question.

| Document | Owns |
| --- | --- |
| [Architecture](architecture.md) | Workspace boundaries, dependency direction, package/app ownership, and extraction rules. |
| [Development](development.md) | Commands, ports, generated assets, verification matrix, and docs checks. |
| [Git workflow](git-workflow.md) | Branch, commit, PR, staging, and monorepo scope conventions. |
| [Typeset README](../apps/typeset/README.md) | Standalone product setup, file/PDF behavior, privacy, and hosting. |
| [Typeset PRODUCT](../apps/typeset/PRODUCT.md) | Standalone product behavior and priorities. |
| [Typeset DESIGN](../apps/typeset/DESIGN.md) | Standalone visual and interaction contract. |
| [RoleFit README](../apps/role-fit-ai/README.md) | Local workbench setup, providers, extension, tracker, and workspace. |
| [RoleFit engineering docs](../apps/role-fit-ai/docs/engineering/README.md) | RoleFit server/AI, UI, and testing contracts. |

Implementation instructions belong in the nearest `AGENTS.md`, not in a
product or design document. Durable cross-workspace decisions belong in root
`CONTINUITY.md`; app-only operational detail may live in the app ledger without
duplicating the same decision.
