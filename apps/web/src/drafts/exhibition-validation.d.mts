import type { ValidationResult } from '@exhibitos/spec';
export function validateLifecycle(document: unknown, options?: {archiveProfile?: 'bounded-file-v1'}): ValidationResult;
export function validateExhibition(document: unknown, options?: {publicationTime?: string;archiveProfile?: 'bounded-file-v1'}): ValidationResult;
