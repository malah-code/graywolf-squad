export const LANE_MAPPING = Object.freeze({
  feature: 'claude',
  tests: 'codex',
  ui: 'opencode',
  complex: 'agy',
});

export function resolveExecutionLane(taskTypeOrTag = 'feature') {
  const normalized = String(taskTypeOrTag).toLowerCase().trim();

  if (
    normalized === 'tests' ||
    normalized === 'test' ||
    normalized === 'bug-bash-sprint' ||
    normalized.includes('test')
  ) {
    return 'codex';
  }

  if (
    normalized === 'ui' ||
    normalized === 'frontend' ||
    normalized.includes('ui')
  ) {
    return 'opencode';
  }

  if (
    normalized === 'complex' ||
    normalized === 'refactor' ||
    normalized === 'architecture'
  ) {
    return 'agy';
  }

  if (Object.prototype.hasOwnProperty.call(LANE_MAPPING, normalized)) {
    return LANE_MAPPING[normalized];
  }

  return 'claude';
}

export function buildLaneCliArgs(options = {}) {
  const lane = options.lane || 'feature';
  const cliTool = LANE_MAPPING[lane] || lane || 'claude';
  const attempt = Number(options.attempt) || 1;
  const briefPath = options.briefPath || '.agents/tasks/brief.md';

  if (attempt === 1) {
    return {
      cliTool,
      args: ['--brief', briefPath, '--format', 'json-rpc-acp'],
    };
  }

  if (!options.sessionId) {
    throw new Error('sessionId is required for Strike 2 execution attempt');
  }

  return {
    cliTool,
    args: [
      '--session',
      options.sessionId,
      '--feedback',
      options.feedback || '',
      '--format',
      'json-rpc-acp',
    ],
  };
}
