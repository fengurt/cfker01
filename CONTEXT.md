# TableAI Resource Operations

This context defines the language for the operations console. It describes the business model only; implementation choices belong in the specification and ADRs.

## Assets and projects

**Project**:
A business product that can have multiple workspaces, repositories, deployments, services, domains and owners.
_Avoid_: directory, repository, deployment

**Asset**:
A discovered external or local resource such as a repository, server, container, DNS record, bucket or Worker.
_Avoid_: project

**Relationship**:
An evidence-backed connection between an asset and a project or another asset.
_Avoid_: guess, fuzzy match

**Lifecycle**:
The operational state of a project: active, maintenance, experimental, archived, unclassified or ignored.
_Avoid_: publication status

## Operational truth

**Fact**:
A provider-observed value with a source, observation time, validity window and confidence.
_Avoid_: annotation, assumption

**Annotation**:
An intentional human business value such as a display name, owner, tag or public description.
_Avoid_: scan result

**Freshness**:
Whether a fact is inside its source-specific validity window.
_Avoid_: healthy

**Incident**:
A deduplicated, actionable operational problem with severity, evidence, ownership and a lifecycle.
_Avoid_: red badge, error count

**Root cause**:
The primary failed entity or check that explains dependent symptoms.
_Avoid_: duplicate incident

## Planning and execution

**Deployment requirement**:
The confirmed runtime, capacity, dependency, region, storage, backup and rollback constraints for a project.
_Avoid_: vague preference

**Placement recommendation**:
An advisory ranking of eligible servers with evidence and explicit exclusion reasons.
_Avoid_: automatic deployment

**Resource snapshot**:
A versioned, redacted, machine-readable view of current operational facts and placement inputs.
_Avoid_: database export

**Operations task**:
A Task Core record created to execute an Incident, renewal, deployment, migration, rollback or review action.
_Avoid_: generic roadmap item

**Trusted device**:
A revocable device-bound login session that may last 90 days and never replaces step-up authentication for sensitive actions.
_Avoid_: trusted IP
