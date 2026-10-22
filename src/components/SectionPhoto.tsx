const descriptions = {
  team: 'Illustrative university students collaborating on an electronics project.',
  mentor: 'Illustrative supervisor and students discussing a project in a university library.',
  ai: 'Illustrative technology workspace with a laptop and a project prototype.',
  planning: 'Illustrative project planning with diagrams, milestones and organized notes.',
  students: 'Illustrative students testing a robotics project in a university laboratory.',
  supervision: 'Illustrative supervisor reviewing research notes with a student.',
  examiner: 'Illustrative academic defense with a student presenting to examiners.',
  coordinator: 'Illustrative coordinator organizing an academic session schedule.',
  guidance: 'Illustrative project consultation with a hand drawn architecture and research notes.',
  support: 'Illustrative technical support engineer maintaining an application workspace.',
  'basic-plan': 'Illustrative student working independently with monthly project guidance.',
  'regular-plan': 'Illustrative developers implementing a defined software project.',
  'advance-plan': 'Illustrative delivery team demonstrating a completed project.',
  enquiry: 'Illustrative client and consultant discussing a new project brief.',
  faq: 'Illustrative university help desk conversation answering a student question.',
} as const;
export type PhotoKind = keyof typeof descriptions;
export function SectionPhoto({
  kind,
  className = '',
  eager = false,
}: {
  kind: PhotoKind;
  className?: string;
  eager?: boolean;
}) {
  return (
    <figure className={'section-photo ' + className}>
      <img
        src={'/images/compass/' + kind + '.webp'}
        alt={descriptions[kind]}
        width="1672"
        height="941"
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={eager ? 'high' : 'auto'}
      />
    </figure>
  );
}
