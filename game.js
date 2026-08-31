'use strict';

/*
 * Summit Pyramid — Node-side game session helpers.
 * Thin orchestration over rules.js used by tooling, tests, and server.js.
 * The browser client loads rules.js/content.js directly.
 */

const R = require('./rules.js');
const C = require('./content.js');

/* Play a full round from a command list; returns final state + score. */
function playRound(seed, commands, options) {
  const { state, results } = R.applyCommands(seed, commands, options);
  return {
    state,
    results,
    score: R.scoreComponents(state),
    terminal: R.isTerminal(state),
    hash: R.stateHash(state)
  };
}

/* Validate a claimed score by replaying commands. Returns {ok, ...}. */
function validateScoreClaim(claim) {
  if (!claim || typeof claim !== 'object') return { ok: false, error: 'bad-request' };
  if (claim.rulesetVersion !== R.RULESET_VERSION) return { ok: false, error: 'stale-version' };
  if (!Number.isInteger(claim.seed) || claim.seed < 0) return { ok: false, error: 'bad-seed' };
  if (!Array.isArray(claim.commands) || claim.commands.length > 1000)
    return { ok: false, error: 'bad-commands' };
  if (!Number.isInteger(claim.claimedScore)) return { ok: false, error: 'bad-score' };
  const { state, results } = R.applyCommands(claim.seed, claim.commands, claim.options);
  if (results.some(r => r && r.error)) return { ok: false, error: 'illegal-commands' };
  const score = R.scoreComponents(state);
  if (score.total !== claim.claimedScore) return { ok: false, error: 'score-mismatch', actual: score.total };
  return {
    ok: true, score: score.total, terminal: R.isTerminal(state),
    hash: R.stateHash(state), moves: state.moves
  };
}

module.exports = { R, C, playRound, validateScoreClaim };
