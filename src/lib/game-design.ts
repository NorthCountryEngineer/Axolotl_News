import type { GameSpec } from './game-types';

/** Data is the only author-controlled input to the fixed game engine. */
export function validateGameSpec(value: unknown): GameSpec {
  function object(input: unknown, keys: string[], label: string): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error(`${label} must be an object.`);
    const record = input as Record<string, unknown>;
    if (Object.keys(record).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(record, key)) || Object.keys(record).some(key => !keys.includes(key))) throw new Error(`${label} has missing or unexpected fields.`);
    return record;
  }
  function text(input: unknown, max: number, label: string, allowEmpty = false): string {
    if (typeof input !== 'string' || (!allowEmpty && !input.trim()) || input !== input.trim() || input.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(input) || /[<>]|(?:https?:\/\/|www\.|javascript\s*:|data\s*:|vbscript\s*:)|\b(?:eval|fetch|import)\s*\(/iu.test(input)) throw new Error(`${label} must be plain text up to ${max} characters, without links or code.`);
    return input;
  }
  function integer(input: unknown, min: number, max: number, label: string): number {
    if (typeof input !== 'number' || !Number.isInteger(input) || input < min || input > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
    return input;
  }
  const spec = object(value, ['version', 'title', 'description', 'genre', 'theme', 'player', 'rules', 'objects', 'instructions'], 'Game');
  const player = object(spec.player, ['name', 'color', 'speed', 'jump'], 'Player');
  const rules = object(spec.rules, ['goal', 'timeLimit', 'lives', 'difficulty'], 'Rules');
  const objects = object(spec.objects, ['collectible', 'hazard'], 'Objects');
  if (spec.version !== 1) throw new Error('Unsupported game version.');
  if (!['collect', 'dodge', 'platformer'].includes(spec.genre as string)) throw new Error('Choose collect, dodge, or platformer.');
  if (!['pond', 'space', 'garden'].includes(spec.theme as string)) throw new Error('Choose pond, space, or garden.');
  if (typeof player.color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(player.color)) throw new Error('Player color must be a six-digit hex color.');
  return {
    version: 1,
    title: text(spec.title, 80, 'Title'), description: text(spec.description, 300, 'Description', true),
    genre: spec.genre as GameSpec['genre'], theme: spec.theme as GameSpec['theme'],
    player: { name: text(player.name, 40, 'Player name'), color: player.color, speed: integer(player.speed, 2, 8, 'Speed'), jump: integer(player.jump, 6, 14, 'Jump') },
    rules: { goal: integer(rules.goal, 3, 40, 'Goal'), timeLimit: integer(rules.timeLimit, 30, 180, 'Time'), lives: integer(rules.lives, 1, 5, 'Lives'), difficulty: integer(rules.difficulty, 1, 5, 'Difficulty') },
    objects: { collectible: text(objects.collectible, 30, 'Collectible'), hazard: text(objects.hazard, 30, 'Hazard') },
    instructions: text(spec.instructions, 300, 'Instructions', true),
  };
}

export function defaultGameSpec(): GameSpec {
  return { version: 1, title: 'Axolotl Pond Adventure', description: 'Help a curious axolotl gather water snacks and steer clear of rocks.', genre: 'collect', theme: 'pond', player: { name: 'Axolotl', color: '#efadc4', speed: 5, jump: 10 }, rules: { goal: 10, timeLimit: 60, lives: 3, difficulty: 2 }, objects: { collectible: 'water snack', hazard: 'rock' }, instructions: 'Use the arrow keys or WASD to swim. Collect 10 water snacks before time runs out. Avoid rocks. Touch controls are available below the game.' };
}

/** A transparent, bounded conversational builder; it does not invoke an AI model. */
export function designGame(message: string, current?: GameSpec): { spec: GameSpec; reply: string } {
  if (typeof message !== 'string' || !message.trim() || message.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(message)) throw new Error('Describe your game in 1 to 2,000 characters.');
  const spec = current ? validateGameSpec(current) : defaultGameSpec();
  const lower = message.toLowerCase();
  const changes: string[] = [], notes: string[] = [];
  const has = (regex: RegExp) => regex.test(lower);
  if (has(/\b(platformer|platforming|jumping game|jump across|jump between)\b/)) { spec.genre = 'platformer'; changes.push('a jumping platform game'); }
  else if (has(/\b(dodge|dodging|avoid(?:ing)? falling|survival)\b/)) { spec.genre = 'dodge'; changes.push('a falling-obstacle dodging game'); }
  else if (has(/\b(?:collection|collecting|collector)(?:[- ]style)? game\b|\bcollector\b|\bcollect game\b|\b(?:genre|style)\s*[:=]?\s*collect\b|\b(?:switch|change)(?: it)? to (?:a )?collect(?:ion)?\b/) || (!current && has(/\b(collect|collecting|gather|gathering)\b/))) { spec.genre = 'collect'; changes.push('a swimming collection game'); }
  // Explicit settings win over incidental object words: stars can belong in a pond.
  const world = lower.match(/\b(pond|underwater|aquarium|lake|ocean|space|galaxy|garden|meadow)\b/)?.[1];
  if (world) {
    spec.theme = ['space', 'galaxy'].includes(world) ? 'space' : ['garden', 'meadow'].includes(world) ? 'garden' : 'pond';
    changes.push(`a ${spec.theme} setting`);
  } else if (has(/\b(stars?|planets?|astronaut)\b/)) { spec.theme = 'space'; changes.push('a space setting'); }
  else if (has(/\bflowers?\b/)) { spec.theme = 'garden'; changes.push('a garden setting'); }
  if (has(/\b(easy|easier|gentle)\b/)) { spec.rules.difficulty = 1; changes.push('easy difficulty'); }
  else if (has(/\b(hard|harder|challenging)\b/)) { spec.rules.difficulty = 4; changes.push('hard difficulty'); }
  const colors: Record<string, string> = { pink: '#efadc4', blue: '#79b9df', green: '#81b29a', purple: '#b99ad7', yellow: '#e8c76b', orange: '#eda16f', red: '#d97a86' };
  const color = lower.match(/\b(?:color|colour)(?:\s*(?:to|is|:|=))?\s*(#[0-9a-f]{6}|pink|blue|green|purple|yellow|orange|red)\b/) || lower.match(/\b(pink|blue|green|purple|yellow|orange|red)\s+(?:axolotl|player|character)\b/);
  if (color) { spec.player.color = colors[color[1]] || color[1]; changes.push('player color'); }
  const snack = lower.match(/\b(?:collect(?:ing)?|gather(?:ing)?)(?:\s+\d+)?(?:\s+(?:pink|blue|green|purple|yellow|orange|red|golden|glowing))?\s+(water snacks?|snacks?|stars?|flowers?|bubbles?)\b/) || lower.match(/\b\d+\s+(water snacks?|snacks?|stars?|flowers?|bubbles?)\b/);
  if (snack) { spec.objects.collectible = snack[1].replace(/s$/u, ''); changes.push(`collectible ${spec.objects.collectible}`); }
  const hazard = lower.match(/\b(?:avoid(?:ing|s)?|dodge|dodging)(?:\s+(?:the|falling))?\s+(rocks?|asteroids?|meteors?|thorns?)\b/);
  if (hazard) { spec.objects.hazard = hazard[1].replace(/s$/u, ''); changes.push(`hazard ${spec.objects.hazard}`); }
  const applyNumber = (label: string, regex: RegExp, assign: (value: number) => void, min: number, max: number, multiplier = 1) => {
    const match = lower.match(regex);
    if (!match) return;
    const value = Number(match[1]) * multiplier;
    if (!Number.isInteger(value) || value < min || value > max) { notes.push(`${label} must be from ${min} to ${max}; I kept the previous value.`); return; }
    assign(value); changes.push(`${label.toLowerCase()} ${value}`);
  };
  applyNumber('Goal', /\b(?:goal|collect|gather)(?:\s*(?:to|is|:|=))?\s*(\d+)\b/, value => { spec.rules.goal = value; }, 3, 40);
  if (!/\b(?:goal|collect|gather)(?:\s*(?:to|is|:|=))?\s*\d+\b/.test(lower)) applyNumber('Goal', /\b(\d+)\s+(?:water snacks?|snacks?|stars?|flowers?|bubbles?)\b/, value => { spec.rules.goal = value; }, 3, 40);
  applyNumber('Time', /\b(\d+)\s*(?:seconds?|secs?)\b/, value => { spec.rules.timeLimit = value; }, 30, 180);
  if (!/\b\d+\s*(?:seconds?|secs?)\b/.test(lower)) applyNumber('Time', /\b(\d+)\s*minutes?\b/, value => { spec.rules.timeLimit = value; }, 30, 180, 60);
  applyNumber('Time', /\btime(?:\s*(?:limit|to|is|:|=))?\s*(\d+)\b/, value => { spec.rules.timeLimit = value; }, 30, 180);
  applyNumber('Lives', /\b(\d+)\s*lives?\b/, value => { spec.rules.lives = value; }, 1, 5);
  applyNumber('Lives', /\blives?(?:\s*(?:to|is|:|=))?\s*(\d+)\b/, value => { spec.rules.lives = value; }, 1, 5);
  applyNumber('Difficulty', /\bdifficulty(?:\s*(?:to|is|:|=))?\s*(\d+)\b/, value => { spec.rules.difficulty = value; }, 1, 5);
  applyNumber('Speed', /\bspeed(?:\s*(?:to|is|:|=))?\s*(\d+)\b/, value => { spec.player.speed = value; }, 2, 8);
  applyNumber('Jump', /\bjump(?:\s*(?:to|is|:|=))?\s*(\d+)\b/, value => { spec.player.jump = value; }, 6, 14);
  const fields: Record<string, (value: string) => void> = {
    title: value => { spec.title = value; }, name: value => { spec.title = value; }, description: value => { spec.description = value; }, player: value => { spec.player.name = value; }, collectible: value => { spec.objects.collectible = value; }, hazard: value => { spec.objects.hazard = value; }, instructions: value => { spec.instructions = value; },
  };
  let customInstructions = false;
  for (const line of message.split('\n')) {
    const match = line.match(/^\s*(title|name|description|player|collectible|hazard|instructions)\s*:\s*(.+?)\s*$/iu);
    if (match) {
      const candidate = structuredClone(spec), field = match[1].toLowerCase();
      fields[field](match[2]);
      try { validateGameSpec(spec); changes.push(field); if (field === 'instructions') customInstructions = true; }
      catch { Object.assign(spec, candidate); notes.push(`The ${field} needs short, plain text without links or code; I kept its previous value.`); }
    }
  }
  const quotedTitle = message.match(/\b(?:call(?:ed)?(?: it)?|title(?:d)?|name(?:d)?(?: it)?)\s+["“]([^"”\n]+)["”]/iu);
  if (quotedTitle) { const previous = spec.title; spec.title = quotedTitle[1].trim(); try { validateGameSpec(spec); changes.push('title'); } catch { spec.title = previous; notes.push('Keep the title to 80 plain-text characters.'); } }
  if (changes.length && !customInstructions) {
    const controls = spec.genre === 'platformer' ? 'Use the arrow keys or WASD to move; Space or Up jumps.' : 'Use the arrow keys or WASD to swim.';
    spec.instructions = `${controls} Collect ${spec.rules.goal} ${spec.objects.collectible}${spec.rules.goal === 1 ? '' : 's'} before time runs out. Avoid ${spec.objects.hazard}s. Touch controls are available below the game.`;
  }
  if (has(/\b(multiplayer|3d|online|chat|leaderboard|shoot(?:ing|er)?|weapons?|upload|custom code|javascript|payment|purchase|soundtrack|music)\b/) || /https?:\/\/|<script|javascript:/iu.test(message)) notes.push('This builder supports single-player 2D collection, dodging, and platform games with built-in artwork. It cannot add custom code, external assets, music, online features, or purchases.');
  const summary = changes.length ? `Updated ${[...new Set(changes)].join(', ')}.` : 'I can build a collection, dodging, or platform game in a pond, space, or garden.';
  const help = changes.length ? 'Test it, then tell me what to change. You can adjust the title, player color, speed, jump, goal, time, lives, and difficulty.' : 'Try “a space platformer, collect 12, 90 seconds, 3 lives,” or use a line such as “Title: Moon Axolotl”.';
  return { spec: validateGameSpec(spec), reply: [summary, ...notes, help].join(' ') };
}
