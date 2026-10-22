# AI behavior and prompts

Gemini provides advisory drafts for proposal/document review, matching, scheduling, reporting, support, reminders/digests and QA. Health classification remains deterministic; model wording does not override rule risk, grades, roles or academic decisions.

The server validates identity, role, project assignment, request fields, consent and authorized evidence before provider calls. Clients cannot inject evidence, recipients or actor IDs. Provider output must satisfy bounded schemas, safety/finish checks and grounded-reference validation. Model responses do not execute code, invoke unrestricted tools or publish academic decisions.

Optional public-source screening requires separate search consent. Fixed HTTPS providers and bounded retrieved passages supply evidence; missing coverage is disclosed. Matching is not a universal plagiarism verdict. QA source export remains tied to a versioned owner-approved payload digest and is not enabled merely by cloning this repository.

Never place keys or real student information in prompts/test fixtures. Use synthetic evidence for development. Quotas, deadlines, bounded retries, validated fallback and human review remain mandatory. Error-handling.md owns failure behavior; Security.md owns access restrictions.
