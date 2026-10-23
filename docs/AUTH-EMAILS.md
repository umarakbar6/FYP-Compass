# Signup confirmation email

`supabase/templates/confirmation.html` is the maintained hosted signup template. It uses Supabase's `ConfirmationURL`, `SiteURL`, `Token` and `Email` variables. The button is an ordinary HTTPS anchor with inline styles and a table layout for email clients. A visible copyable confirmation link and an email-code alternative are included. There is no JavaScript or form inside the email.

The image at `/brand/compass-email.png` is a raster rendering of the existing website compass icon, so email clients do not need SVG support. Its meaningful alt text and adjacent wordmark remain readable when images are blocked.

For the owned deployment, update only `mailer_subjects_confirmation` and `mailer_templates_confirmation_content` through the Supabase Auth configuration API, after privately backing up the old template. Keep SMTP credentials, email confirmation, CAPTCHA, MFA, quotas and redirect allowlists unchanged. The suggested subject is `Confirm your email | FYP Compass`.

Deploy the website's logo and email-code form before applying a template that references them. `/auth/confirm` accepts an email and a code only after explicit submission, uses the signup verification type, preserves CAPTCHA requirements and handles wrong, expired, used and rate-limited codes. It never marks an account confirmed in browser storage or bypasses server verification.

Previously delivered emails cannot be edited. Request a fresh confirmation message after the update and use the latest link/code. If an email app blocks links, type the verification page address into a browser and enter the email code. If an old message predates the code template, request a new one. Link expiry is controlled by Supabase; no success is claimed for an expired or consumed token.

Official reference: https://supabase.com/docs/guides/auth/auth-email-templates and https://supabase.com/docs/reference/javascript/auth-verifyotp.

The code page also requests a fresh signup email directly. Resend waiting time is separate from code verification; provider throttles block repeated requests and show a safe error without a false sent message.

## Mobile email compatibility repair

The primary button and visible backup now open the first-party `/auth/confirm#confirmation_token=...` page, using Supabase `TokenHash`. A user explicitly submits the proof after the security check. Merely fetching or previewing the link never consumes it. The fragment stays out of HTTP request logs and is removed from browser history after the page captures it in memory. Refreshing uses the email-code alternative. Verification accepts only signup proofs, never a URL-supplied role, redirect or authentication type. Existing Supabase confirmation URLs remain supported.

The versioned raster logo `/brand/compass-email-v2.png` permits cross-origin image embedding. Only this public image gets the exception; the application keeps its same-origin resource policy. Its new URL avoids cached failures for the previous image. Email apps may still block all remote images or links by user/security policy; the code and typed verification address remain visible. Previously delivered emails cannot change.
