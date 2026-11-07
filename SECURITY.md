# Security policy

## Status
Fulcrum has no released builds yet. This policy covers the repository and, once releases exist, the latest release.

## Reporting a vulnerability
Please use GitHub's **private vulnerability reporting** for this repository (Security tab → "Report a vulnerability"). Do not open a public issue for security problems, and do not include real personal or company data in a report — a synthetic reproduction is enough.

Expect an acknowledgement within 7 days. This is a single-maintainer project; fixes are best-effort.

## Scope
Especially interested in: prompt injection that changes state or exfiltrates data, MCP access-control bypasses, credential exposure, unsafe handling of the workspace folder, and supply-chain issues.

## Design
The threat model and trust boundaries are documented in [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

## Accidental data exposure
If you find real personal data, credentials or company content committed to this repository, report it privately as above so it can be removed from history.
