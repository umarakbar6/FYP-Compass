# Contributions

Use a feature branch and open a pull request. Keep production credentials, academic records, database backups, authenticator material and deployment logs out of Git. Use `.env.example` for names and placeholders only.

Run the documented tests using synthetic data. Add a regression for security-sensitive changes. Do not replace authorization with client metadata, permit arbitrary AI evidence, weaken file checks or widen CORS to make tests pass. Changes to migration order require an additive migration and installer verification.

Install Gitleaks and configure `git config core.hooksPath .githooks` for the local push guard. Automated checks supplement review; they do not authorize use of the production system.
