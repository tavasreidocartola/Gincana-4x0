'use strict';

function shuffleWithRandom(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function seedFirstRoundTeams(teams, random = Math.random) {
  if (!Array.isArray(teams) || teams.length !== 16) {
    return shuffleWithRandom(Array.isArray(teams) ? teams : [], random);
  }
  const humans = shuffleWithRandom(teams.filter((team) => Boolean(team && team.isHuman)), random);
  const bots = shuffleWithRandom(teams.filter((team) => !team || !team.isHuman), random);
  if (humans.length === 0) return shuffleWithRandom(teams, random);
  const seeded = new Array(16).fill(null);
  if (humans.length <= 8) {
    // Separate real participants during round one. With two humans, seat them
    // in opposite halves so they can only meet in the final if both keep winning.
    const offset = Math.floor(random() * 8);
    humans.forEach((team, index) => {
      const matchIndex = (offset + Math.floor(index * 8 / humans.length)) % 8;
      seeded[matchIndex * 2] = team;
    });
  } else {
    // More than eight humans makes some human-vs-human games unavoidable.
    humans.slice(0, 8).forEach((team, index) => { seeded[index * 2] = team; });
    humans.slice(8).forEach((team, index) => { seeded[index * 2 + 1] = team; });
  }
  let botIndex = 0;
  for (let slot = 0; slot < seeded.length; slot++) {
    if (!seeded[slot]) seeded[slot] = bots[botIndex++];
  }
  return seeded;
}
module.exports = { seedFirstRoundTeams };
