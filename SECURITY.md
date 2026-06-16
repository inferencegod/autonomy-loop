# Security Policy

## Supported Versions
autonomy-loop is pre-1.0. The latest release on `main` is the only supported version.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability
Please report security issues privately via the repo's **Security** tab
("Report a vulnerability"), not a public issue. We aim to acknowledge within 72 hours
and will tell you whether the report is accepted (with a fix timeline) or declined.

## Scope
autonomy-loop runs locally and ships no servers or secrets. The PreToolUse gate-guard
hook blocks prod pushes, force-pushes, history rewrites, and edits to protected paths.
Review `autonomy-loop/hooks/` before use.
