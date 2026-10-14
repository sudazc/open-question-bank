export type DiagnosticSeverity = 'fatal' | 'error' | 'warning' | 'info';

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  file: string;
  entityId?: string;
  fieldPath?: string;
  suggestion?: string;
  line?: number;
  column?: number;
}

export function hasBlockingDiagnostics(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(({ severity }) => severity === 'fatal' || severity === 'error');
}
