import type { ValidationResult } from '@exhibitos/spec';
export function validateLifecycle(document: unknown): ValidationResult;
export function validateExhibition(document: unknown, options?: {publicationTime?: string}): ValidationResult;
