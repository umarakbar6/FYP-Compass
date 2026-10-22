# FYP Compass — controlled client onboarding

The connected deployment belongs to Umar Akbar. The nine existing logins are synthetic demo identities; they are not a real institution roster. Keep their passwords in Demo-Login-Private.txt, outside public source and the handover ZIP.

## Before inviting an institution
1. Sign in as coordinator and open Service status. Set the actual institution name, support email and IANA time zone. Then configure the active academic session.
2. Collect an approved roster of student, supervisor and examiner email addresses. Use Supabase Authentication to invite named users; assign their intended application role in fyp_profiles through the existing controlled administration workflow. Do not grant organization ownership to application users.
3. Enrol students in the active session; add supervisor capacities/topic preferences, controlled topics and milestone templates. Create groups only from enrolled students.
4. Test one actual student and assigned supervisor together: proposal → matching → review → verified document upload → milestone review. Test examiner privacy and coordinator result release separately.
5. Have the institution approve its actual retention period, privacy notice, consent for anonymized AI explanations and academic review process. The software does not invent legal policies or allow AI to determine grades.
6. Check Auth URL configuration points to https://fyp-compass-ten.vercel.app and verify one invitation/reset email end to end with the recipient. Supabase email delivery limits still apply; this release does not promise bulk invitations or a configured custom SMTP service.

## Daily operations without paid services
- Coordinator Service status displays the last 24 hours of recorded AI attempts, Gemini/fallback/failed counts, interrupted reservations, upload screening totals and latest reminder generation.
- AI is capped at 5 attempts per supervisor per 15 minutes, 20 per rolling 24 hours and 100 globally per rolling 24 hours. Failed attempts count; a group with an existing or in-progress draft cannot start another generation.
- Limits protect usage, not guaranteed Google free quota. Provider errors still produce the existing safe rule-based fallback; human review is required before publication.
- Run node backend/local-tests/backup-restore.mjs from the project root for an encrypted application-data/storage snapshot and isolated recovery drill. This requires the signed-in Supabase CLI and private deployment configuration.
- Keep an explicitly exported recovery key and an encrypted backup on a separate trusted device before relying on disaster recovery. The default DPAPI-protected recovery key depends on this Windows user/machine. Keep an explicitly exported key separate from the encrypted backup. Do not upload private backups into the public project ZIP.
- New files are PDF/DOCX only, up to 10 MB. Plain content checks reject macros, executable/embedded content, active PDF actions, external DOCX links and archive expansion abuse. This is not a full antivirus guarantee; convert unsupported legacy DOC files.

## Scope of verification
Automated tests and Chromium-style browser viewports do not certify every real phone, Safari or Firefox. Use the supplied cross-device checklist with the client before broad rollout. A bounded isolated database concurrency test is not an internet-scale capacity certification.
