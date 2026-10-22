-- Cloud-only, rerunnable. Only the FYP Compass reminder job is created/updated.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('fyp-compass-deadline-reminders','0 * * * *','select fyp_engagement_v1.refresh_reminders();');
select fyp_engagement_v1.refresh_reminders(true) as inserted_reminders;
select jobname,schedule,active from cron.job where jobname='fyp-compass-deadline-reminders';
