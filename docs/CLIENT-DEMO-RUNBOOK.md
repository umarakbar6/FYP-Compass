# FYP Compass client demonstration

The original MVP and ten detailed acceptance procedures are preserved in ORIGINAL-MVP-PRD.md and ORIGINAL-TEN-ACCEPTANCE-CASES.md. Use synthetic local accounts for a repeatable presentation; production accounts follow the live security policy.

## Start locally

Use Node 24. Run `npm ci --ignore-scripts`, `npm ci --prefix backend/local-tests --ignore-scripts`, and `npm run demo:local`. Open http://127.0.0.1:5182. The account selector provides students, supervisors, examiners and a coordinator. This is a loopback-only demonstration identity adapter. The complete database and private files persist under `.private/local-backend-full`; Ctrl+C closes them safely.

The start command never resets data or stops another program. Choose two free ports with `FYP_LOCAL_WEB_PORT` and `FYP_LOCAL_API_PORT` if necessary. For automated workflow fixtures, use a fresh local data directory and run `npm run seed:local-audit` once; the seed refuses to replace an existing demonstration session.

## Present the complete workflow

1. As coordinator, show the active session, topic list, enrollment, three supervisor capacities and milestone template.
2. As Student One, create a group including Student Two and Student Three. Submit a proposal with up to three topics and three distinct ranked supervisors.
3. As coordinator, run matching with a saved seed. Explain that preference rounds precede topic fit, topic points cap at two, and capacity cannot overflow.
4. As the allocated supervisor, run similarity screening and approve the proposal. A flagged similarity requires a recorded justification. Approval creates the milestone plan.
5. As students, upload a plain PDF and supply each member's own contribution. Show supervisor rework and acceptance.
6. Collect confidential peer ratings. Show deterministic health and a private draft. Local health uses the clearly labeled required fallback when a private Gemini key is absent. Edit and approve a notice as supervisor; students receive only the approved notice.
7. Save supervisor marks and certify readiness. As coordinator, show that incomplete milestones and unpaid fees block scheduling; assign two different examiners when ready.
8. As each examiner separately, submit the independent group marks and each student's viva mark. An examiner cannot inspect the other's assessment.
9. Finalize as coordinator, show that student results remain hidden, then release. The fixed 55/45 formula can produce different student totals.
10. Open the accreditation report, compare its SQL counts and marks, and use its print/export controls. Show mobile navigation, refresh the result/notice page, and sign out.

## Cloud authentication

The live site is https://fyp-compass-ten.vercel.app. Public students use confirmed signup and their own credentials. The currently verified cloud policy disables shared demo accounts and requires staff MFA. Existing personal accounts, CAPTCHA and MFA are preserved; no shared demo credentials are re-enabled for testing. An owner or verified staff member should complete their own authenticator challenge when demonstrating the live portal.

## Verification evidence

Use `npm run test:local-browser` against the seeded local stack, `npm run test:e2e` for three-engine accessibility/responsive checks, and `npm run test:mvp` for the original acceptance gate. The dated acceptance report distinguishes actual provider runs, controlled tests, the required fallback and external device certification. An initial failing result remains in the evidence when a corrective rerun passes.
