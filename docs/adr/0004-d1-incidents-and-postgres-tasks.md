# D1 incidents and PostgreSQL tasks

Resource facts, monitoring events, Incidents and audit records remain owned by the catalog D1 context; Task Core remains the PostgreSQL authority for collaborative execution. Incident-to-Task links use an idempotent outbox because the two databases cannot share a transaction.
