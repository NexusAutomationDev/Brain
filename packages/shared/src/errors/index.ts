// Base error classes for Brain Core
export class BrainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BrainError';
  }
}

export class ConfigurationError extends BrainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', context);
    this.name = 'ConfigurationError';
  }
}

export class BrainOutputValidationError extends BrainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BRAIN_OUTPUT_VALIDATION_ERROR', context);
    this.name = 'BrainOutputValidationError';
  }
}
