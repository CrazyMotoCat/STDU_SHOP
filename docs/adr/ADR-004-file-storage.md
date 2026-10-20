# ADR-004: Private local file storage

Status: ACCEPTED by the owner in the R1-001 implementation assignment, 2026-10-21.

## Decision

Use the private `private-files` Docker volume, mounted only into NestJS at `/data/files`. No static file server or public volume mount is permitted. The future filesystem adapter implements `StoragePort`, uses opaque unpredictable storage keys and never accepts a client-controlled filesystem path. Preserve immutable originals and approved document versions; metadata, domain links, ACL and versions belong to NestJS/PostgreSQL.

Downloads must pass a domain authorization check or a narrowly scoped quotation capability. Python receives staged inputs through an internal service contract, not unrestricted access to business tables or public files. A storage interface is not an upload endpoint or an authorization policy.

## Backup and operations

An encrypted off-site copy must include PostgreSQL, this volume and versioned configuration. Keep backup keys outside Git and outside the only VDS. Before commercial release, restore the database and matching files into an isolated environment and verify checksums/revision links. The provider, retention, credentials and schedule are operational configuration; R1-001 does not claim that off-site backup exists.

## R1-001 boundary

Provide the volume, configuration and an infrastructure-only `StoragePort` type. No upload/download API, document workflow, antivirus process or file scanning is implemented. Select and verify quarantine/scanning before implementing uploads. Unchecked files must remain unusable in those future scenarios. No S3, MinIO or paid storage service is added.
