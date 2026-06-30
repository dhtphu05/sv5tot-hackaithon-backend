import type { CollectiveRulesEvaluation } from './collective.rules';

export function buildCollectiveNextActions(evaluation: CollectiveRulesEvaluation): string[] {
  const actions = evaluation.rules
    .filter((rule) => !rule.passed)
    .map((rule) => {
      switch (rule.code) {
        case 'participation_rate':
          return 'Update roster participation status until the required participation rate is met';
        case 'school_sv5t_rate':
          return 'Update individual SV5T levels for members with confirmed results';
        case 'higher_level_or_foundation':
          return 'Attach foundation evidence or higher-level achiever proof for human review';
        case 'no_violation':
          return 'Resolve or correct violation records before submission';
        case 'collective_evidence':
          return 'Create at least one collective evidence and upload supporting files';
        default:
          return rule.message;
      }
    });

  if (evaluation.requiresHumanReview) {
    actions.push('Submit for officer review once data and evidence are complete');
  }

  return [...new Set(actions)];
}
