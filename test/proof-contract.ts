import { matrices } from './matrices.ts';

/** Independent question families required for every frozen model. */
export const summaryQuestions = ['how many feasible pairs lack comparable execution', 'how many selected cases have unavailable outcomes', 'which selected cases have contradictory comparable outcomes'] as const;
/** Models whose proof also exhausts exact gap pages. */
export const detailedModels = matrices.filter(model => model.model_key === 'pm-csv');
/** Derive non-vacuity from the corpus rather than a stale literal count. */
export function expectedQuestions(): number { return matrices.length * summaryQuestions.length + detailedModels.length; }
