# Security policy

Report vulnerabilities privately through this repository's Security → Report a vulnerability feature. Do not include passwords, tokens, private student records, reset links, authenticator keys or recovery codes in issues or pull requests.

Test against an isolated local deployment using synthetic accounts. Public source availability does not authorize testing the hosted service, accessing another user's work, sending mail, generating provider charges or exhausting resources.

Trust boundaries: server-only secrets; verified Auth identities; caller-scoped RPC authorization; mandatory staff MFA when configured; private storage with content attestations; bounded bodies/uploads; AI consent, evidence validation, quotas and human review. Browser route guards supplement database/API authorization. Source screening is advisory evidence and upload checks are content screening, not an antivirus certification.

Keep dependencies patched, provider account MFA enabled and recovery codes outside the repository. If a real secret is exposed, revoke it at the provider; deleting a file or commit alone does not revoke access. No finite audit guarantees immunity from every future attack.
