import { useLocation } from 'react-router-dom';
import { SectionPhoto, type PhotoKind } from './SectionPhoto';
import type { Role } from '../types/shared';
const scenes: Record<string, { kind: PhotoKind; title: string; detail: string }> = {
  assistants: {
    kind: 'ai',
    title: 'A little clarity. A better next step.',
    detail:
      'Explore your AI assistants, review their drafts and stay in control of every decision.',
  },
  health: {
    kind: 'ai',
    title: 'See progress. Spot what needs attention.',
    detail: 'Review project health and the evidence behind each recommendation.',
  },
  'service-status': {
    kind: 'ai',
    title: 'A clearer view of your platform.',
    detail: 'Check service readiness, delivery and the workflows keeping your projects connected.',
  },
  group: {
    kind: 'students',
    title: 'Good projects begin with a good team.',
    detail: 'Keep your people, responsibilities and shared project journey together.',
  },
  groups: {
    kind: 'supervision',
    title: 'Your teams. Your guidance. Shared progress.',
    detail: 'Stay close to the groups you supervise and the work they are building.',
  },
  proposal: {
    kind: 'guidance',
    title: 'Give your idea a clear direction.',
    detail: 'Shape your proposal and connect your project to the right expertise.',
  },
  proposals: {
    kind: 'supervision',
    title: 'Turn good ideas into a practical plan.',
    detail: 'Review proposals with clear feedback and evidence.',
  },
  milestones: {
    kind: 'planning',
    title: 'Make every milestone count.',
    detail: 'Keep deadlines, evidence and feedback in one focused workspace.',
  },
  reports: {
    kind: 'planning',
    title: 'The whole session, in focus.',
    detail: 'Explore allocations, progress and the results behind your academic session.',
  },
  assessment: {
    kind: 'examiner',
    title: 'Clear evidence. Thoughtful assessment.',
    detail: 'Manage evaluations and results through your authorized role.',
  },
  defenses: {
    kind: 'examiner',
    title: 'Ready for the next big conversation.',
    detail: 'Keep your assigned defenses and independent evaluations organized.',
  },
  results: {
    kind: 'planning',
    title: 'Your work. Your progress. Your results.',
    detail: 'See the results released for your own academic journey.',
  },
  users: {
    kind: 'coordinator',
    title: 'Bring the right people into the workspace.',
    detail: 'Invite real users with clear roles and protected account access.',
  },
  matching: {
    kind: 'supervision',
    title: 'Connect ideas with the right expertise.',
    detail: 'Review supervisor capacity and allocations with a human decision at every step.',
  },
  configuration: {
    kind: 'coordinator',
    title: 'Set your session up for success.',
    detail: 'Keep sessions, topics and capacity organized from the beginning.',
  },
  help: {
    kind: 'faq',
    title: 'Support for the next step.',
    detail: 'Find guidance, reminders and the information you need to keep moving.',
  },
  notices: {
    kind: 'team',
    title: 'Keep everyone in the loop.',
    detail: 'Read project updates and notices shared through your workspace.',
  },
  enquiries: {
    kind: 'enquiry',
    title: 'From a conversation to a clear brief.',
    detail: 'Review service enquiries and help clients shape their next project.',
  },
  'case-studies': {
    kind: 'team',
    title: 'Work worth sharing.',
    detail: 'Prepare verified project stories and publish them with permission.',
  },
  peers: {
    kind: 'team',
    title: 'Make every contribution visible.',
    detail: 'Record peer evidence and support a fair project assessment.',
  },
};
const overviews: Record<Role, { kind: PhotoKind; title: string; detail: string }> = {
  student: {
    kind: 'students',
    title: 'Your next great idea starts here.',
    detail: 'Bring your team together, follow your milestones and keep your project moving.',
  },
  supervisor: {
    kind: 'supervision',
    title: 'Guide the work that comes next.',
    detail: 'See your assigned teams, review their progress and turn feedback into action.',
  },
  examiner: {
    kind: 'examiner',
    title: 'A focused space for fair assessment.',
    detail: 'Stay organized for assigned defenses and independent evaluations.',
  },
  coordinator: {
    kind: 'coordinator',
    title: 'Your session, in focus.',
    detail: 'Connect people, track progress and keep the whole academic journey on course.',
  },
};
export function WorkspaceBanner({ role, label }: { role: Role; label: string }) {
  const route = useLocation().pathname.split('/')[2] || 'dashboard';
  const scene = scenes[route] || overviews[role];
  return (
    <section className="workspace-banner" aria-label={label + ' workspace introduction'}>
      <div className="workspace-banner-copy">
        <span className="workspace-banner-kicker">FYP COMPASS / {role.toUpperCase()}</span>
        <p className="workspace-banner-title">{scene.title}</p>
        <p className="workspace-banner-detail">{scene.detail}</p>
      </div>
      <SectionPhoto kind={scene.kind} className="workspace-banner-photo" eager />
    </section>
  );
}
