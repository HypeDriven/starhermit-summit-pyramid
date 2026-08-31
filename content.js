'use strict';

/*
 * Summit Pyramid — versioned content data.
 * Works in Node (module.exports) and the browser (globalThis.SummitContent).
 */

(function (root, factory) {
  const rules = (typeof module === 'object' && module.exports) ? require('./rules.js') : root.SummitRules;
  const api = factory(rules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SummitContent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {

  const CONTENT_VERSION = 1;

  /* ---- visual themes ---- */
  const THEMES = [
    { id: 'dusk', name: 'Dusk Dunes', sky: 0x0b1026, horizon: 0x3a2a55, sand: 0x8a6a4a, accent: 0xffb35c, cardBack: 0x274060, marker: 0x7df0ff },
    { id: 'oasis', name: 'Night Oasis', sky: 0x062028, horizon: 0x0d4a4a, sand: 0x6f6a4f, accent: 0x39d0a5, cardBack: 0x144a3c, marker: 0xaef0d0 },
    { id: 'ember', name: 'Ember Flats', sky: 0x1c0a14, horizon: 0x54222c, sand: 0x8a5a40, accent: 0xff7043, cardBack: 0x5a2430, marker: 0xffd08a },
    { id: 'frost', name: 'Cold Mirage', sky: 0x0a1430, horizon: 0x2a3a6a, sand: 0x7a7a8a, accent: 0x8ab4ff, cardBack: 0x2c3a5c, marker: 0xd0e8ff },
    { id: 'violet', name: 'Violet Hollow', sky: 0x140a24, horizon: 0x3c2060, sand: 0x6a5a6a, accent: 0xc084fc, cardBack: 0x3a2450, marker: 0xf0c0ff }
  ];

  /* ---- journey stages (40, procedurally authored from fixed parameters) ---- */
  const STAGE_COUNT = 40;
  const STAGE_BASE_SEED = 0x5eed00;

  function stageAt(i) {
    const n = i + 1;
    const tier = Math.min(5, Math.floor(i / 8) + 1); // difficulty tier 1..5
    const recycles = i < 8 ? 3 : i < 24 ? 2 : 1;
    const mastery = n % 10 === 0;
    const id = 'stage-' + String(n).padStart(2, '0');
    const seed = (STAGE_BASE_SEED + i * 7919) >>> 0;
    return {
      id, index: i, seed,
      name: (mastery ? 'Mastery: ' : 'Ascent ') + n,
      goals: { clearPyramid: true, parScore: 800 + tier * 300, parMoves: 45 - tier * 2 },
      mechanics: { recycles, moveLimit: null },
      par: { score: 800 + tier * 300, moves: 45 - tier * 2 },
      tutorial: i === 0, // first stage replays the intro lesson
      mastery,
      theme: THEMES[i % THEMES.length].id,
      difficulty: tier
    };
  }

  const STAGES = [];
  for (let i = 0; i < STAGE_COUNT; i++) STAGES.push(stageAt(i));

  function stageById(id) { return STAGES.find(s => s.id === id) || null; }

  /* ---- interactive tutorial (Learn mode) ---- */
  // Fixed lesson seeds chosen so each required action is immediately available.
  const TUTORIAL = {
    id: 'learn', name: 'Learn the Summit',
    lessons: [
      {
        id: 'pair', title: 'Pair to 21',
        text: 'Cards are worth their rank (A=1 … K=13). Select two uncovered cards that total 21 to remove them.',
        require: { type: 'remove' }, seed: 102
      },
      {
        id: 'cover', title: 'Uncover the peak',
        text: 'A card is covered until both cards below it are removed. Clear pairs to uncover the cards above.',
        require: { type: 'remove' }, seed: 102
      },
      {
        id: 'draw', title: 'Draw from the stock',
        text: 'Stuck? Draw the top stock card onto the waste pile.',
        require: { type: 'draw' }, seed: 202
      },
      {
        id: 'waste-pair', title: 'Use the waste',
        text: 'The top waste card can pair with any uncovered pyramid card.',
        require: { type: 'remove', waste: true }, seed: 102
      },
      {
        id: 'recycle', title: 'Recycle the waste',
        text: 'When the stock runs out you may flip the waste back over — but only a limited number of times.',
        require: { type: 'recycle' }, seed: 303, recycles: 1, drawAll: true
      }
    ]
  };

  /* ---- daily seed (deterministic from UTC date) ---- */
  function dailySeed(date) {
    const d = date ? new Date(date) : new Date();
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    const key = y * 10000 + m * 100 + day;
    return parseInt(R.fnv1a('summit-daily-' + key), 16) >>> 0;
  }
  function dailyId(date) {
    const d = date ? new Date(date) : new Date();
    return d.toISOString().slice(0, 10);
  }

  /* ---- challenge variants ---- */
  const CHALLENGES = [
    { id: 'moves-40', name: 'Forty Moves', description: 'Clear the pyramid within 40 moves.', mechanics: { recycles: 2, moveLimit: 40 }, seed: 4001, difficulty: 3 },
    { id: 'no-recycle', name: 'One Pass', description: 'No waste recycling. Every draw counts.', mechanics: { recycles: 0, moveLimit: null }, seed: 4002, difficulty: 4 },
    { id: 'moves-35', name: 'Speed Ascent', description: 'A speed target: clear within 35 moves.', mechanics: { recycles: 2, moveLimit: 35 }, seed: 4003, difficulty: 5 },
    { id: 'thin-air', name: 'Thin Air', description: 'One recycle, forty-five moves.', mechanics: { recycles: 1, moveLimit: 45 }, seed: 4004, difficulty: 4 }
  ];
  function challengeById(id) { return CHALLENGES.find(c => c.id === id) || null; }

  /* ---- practice difficulty metadata ---- */
  const DIFFICULTIES = [
    { id: 'easy', label: 'Foothill', recycles: 3, description: 'Three recycles. Learn the ropes.' },
    { id: 'normal', label: 'Ridge', recycles: 2, description: 'The standard ascent.' },
    { id: 'hard', label: 'Summit', recycles: 1, description: 'One recycle. Plan ahead.' }
  ];

  /* ---- achievements (static, idempotent) ---- */
  const ACHIEVEMENTS = [
    { id: 'first-clear', name: 'First Light', description: 'Clear your first pyramid.' },
    { id: 'mechanic-master', name: 'Seasoned Climber', description: 'Win a game after using draw, recycle, and undo.' },
    { id: 'streak-3', name: 'Three Sunrises', description: 'Win three games in a row.' },
    { id: 'stage-20', name: 'Half the Sky', description: 'Complete Journey stage 20.' },
    { id: 'pairs-500', name: 'Long Trail', description: 'Remove 500 pairs in total.' }
  ];

  /* ---- validators (used by test.js and offline tooling) ---- */
  function validateStages() {
    const errors = [];
    const seen = new Set();
    for (const s of STAGES) {
      if (seen.has(s.id)) errors.push(s.id + ': duplicate id');
      seen.add(s.id);
      if (!Number.isInteger(s.seed) || s.seed < 0) errors.push(s.id + ': bad seed');
      if (!THEMES.some(t => t.id === s.theme)) errors.push(s.id + ': unknown theme');
      const st = R.newGame(s.seed, s.mechanics);
      if (st.status !== 'active') errors.push(s.id + ': initial state not active');
      if (R.legalActions(st).length === 0) errors.push(s.id + ': no legal move at start');
      if (st.stock.length !== R.STOCK_SIZE) errors.push(s.id + ': stock not bounded to ' + R.STOCK_SIZE);
      if (!(s.par.score > 0 && s.par.moves > 0)) errors.push(s.id + ': bad par values');
    }
    for (const c of CHALLENGES) {
      const st = R.newGame(c.seed, c.mechanics);
      if (R.legalActions(st).length === 0) errors.push(c.id + ': no legal move at start');
    }
    return errors;
  }

  return {
    CONTENT_VERSION, THEMES, STAGES, STAGE_COUNT, stageAt, stageById,
    TUTORIAL, dailySeed, dailyId, CHALLENGES, challengeById,
    DIFFICULTIES, ACHIEVEMENTS, validateStages
  };
});
