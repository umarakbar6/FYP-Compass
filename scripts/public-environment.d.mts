export const publicEnvironmentNames: readonly string[];
export function assertPublicEnvironment(environment: Record<string, unknown>): void;
export function stripAutomaticVercelMetadata(environment: Record<string, unknown>): void;
