# Cross-device acceptance checklist

Record browser version, device, date and pass/fail with screenshots. Do not mark untested devices as passed.

| Environment | Required checks | Execution status |
|---|---|---|
| Chromium-style in-app browser | Login, role route, keyboard focus, 320/375/768/1024/1440 px reflow, service status | Automated evidence supplied separately |
| Real Android Chrome | Touch menu, portrait/landscape, PDF/DOCX picker, sign-out, slow connection recovery | Client/device check needed |
| Real iPhone/iPad Safari | Touch menu, keyboard, native file picker, viewport zoom, private session handling | Client/device check needed |
| Desktop Firefox | Keyboard-only navigation, dialog focus, uploads, role redirects | Browser check needed |
| Desktop Edge/Chrome | Login, proposal/milestone workflows, zoom 200%, screen reader labels | Client browser check needed |

For every role: direct-link authorization, empty/loading/error state, long names, concurrent edit rejection and private draft/result visibility. Uploaded documents must be successfully content-verified before attachment; an offline verification request must leave them unattached.

Existing acceptance evidence uses synthetic accounts. No statement in this file implies physical-device coverage or a formal accessibility certification.
