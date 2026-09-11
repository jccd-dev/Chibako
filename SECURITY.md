# Security Policy

## Supported Versions

Only the latest release on `main` is supported with security updates.

## Reporting a Vulnerability

Please do **not** open a public issue for security vulnerabilities.

Report privately using GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(Security tab → "Report a vulnerability"), or email the maintainer listed on the
repository profile.

Include:

- A description of the issue and its impact
- Steps to reproduce (proof of concept if possible)
- Affected version or commit

You can expect an acknowledgement within a few days. Please give us a reasonable
window to release a fix before any public disclosure.

## Scope

This project is a self-hosted application. Relevant reports include authentication
and session handling, API key handling, SQL injection, path traversal, and
server-side request handling in the REST API and MCP server.

Deployment misconfiguration (for example, exposing the app without TLS or
committing a real `.env`) is out of scope.
