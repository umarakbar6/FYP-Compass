export const coreV2 = import.meta.env.VITE_BACKEND_API === 'v2';
export const localBackend = import.meta.env.VITE_LOCAL_BACKEND === 'true';
export const submissionBucket = coreV2 ? 'fyp-v2-submissions' : 'fyp-submissions';
const coreNames = new Set([
  'get_student_workspace',
  'create_student_group',
  'save_student_proposal',
  'get_supervisor_workspace',
  'review_supervisor_proposal',
  'get_milestone_workspace',
  'submit_student_milestone',
  'save_milestone_contribution',
  'review_supervisor_milestone',
]);
export function rpcName(name: string) {
  return coreV2
    ? coreNames.has(name)
      ? 'fyp_v2_core_' + name
      : name === 'fyp_run_similarity_screen'
        ? 'fyp_v2_core_run_similarity_screen'
        : name
    : name;
}
