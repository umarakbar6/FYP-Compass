export async function dispatchEmail({ body, user, client, admin, send }) {
  const diagnostic = body.type === 'delivery_test';
  let id,
    claimed = false;
  const finish = (status) =>
    admin.rpc(diagnostic ? 'fyp_email_test_finish' : 'fyp_reminder_delivery_finish', {
      p_id: id,
      p_actor: user.id,
      p_status: status,
    });
  try {
    let d;
    if (diagnostic) {
      const r = await admin.rpc('fyp_email_test_prepare', {
        p_id: body.request_id,
        p_actor: user.id,
      });
      if (r.error)
        return {
          status: r.error.code === 'P0429' ? 429 : 403,
          body: { error: 'Coordinator access and the daily email-test limit are required.' },
        };
      d = r.data;
      id = d.id;
      claimed = d.claimed;
    } else {
      const r = await client.rpc('fyp_reminder_delivery_prepare', {
        p_reminder_id: body.reminder_id,
        p_run_id: body.run_id,
      });
      if (r.error)
        return {
          status: r.error.code === 'P0429' ? 429 : 403,
          body: { error: 'The reminder, consent or draft is no longer eligible.' },
        };
      d = r.data;
      id = d.id;
      if (d.status === 'sent') return { status: 200, body: { status: 'sent', reference: id } };
      const claim = await admin.rpc('fyp_reminder_smtp_claim', { p_id: id, p_actor: user.id });
      if (claim.error)
        return { status: 403, body: { error: 'The reminder is no longer eligible.' } };
      claimed = claim.data === true;
    }
    if (d.status === 'sent') return { status: 200, body: { status: 'sent', reference: id } };
    if (!claimed)
      return {
        status: 409,
        body: {
          error:
            'This SMTP attempt is already processing or needs coordinator reconciliation. It will not be sent twice automatically.',
          reference: id,
        },
      };
    const text = diagnostic
      ? 'FYP Compass reminder email delivery check. You approved this fixed test to your own registered email. No project records or passwords are included. Reference: ' +
        id
      : d.name +
        ' | ' +
        d.group_name +
        '\nDue: ' +
        d.deadline +
        '\n\n' +
        d.text +
        '\n\nYou approved this reminder. Turn off reminders in Help & reminders to opt out.';
    await send({
      to: user.email,
      subject: diagnostic
        ? 'FYP Compass reminder delivery check'
        : 'FYP Compass milestone reminder',
      text,
      messageId: '<' + id + '@fyp-compass-ten.vercel.app>',
    });
    const saved = await finish('sent');
    if (saved.error) throw Error('Receipt unavailable');
    return { status: 200, body: { status: 'sent', reference: id } };
  } catch {
    if (id && claimed) {
      try {
        await finish('failed');
      } catch {
        /* Claim stays consumed; no unsafe automatic resend. */
      }
    }
    return {
      status: 503,
      body: {
        error:
          'Delivery could not be confirmed. The same SMTP attempt will not automatically resend; ask the coordinator to reconcile it.',
        ...(id ? { reference: id } : {}),
      },
    };
  }
}
