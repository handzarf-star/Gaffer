// A small made-up world for the career tests: 32 clubs, 26 players each, deterministic ratings. No real data involved.
import { indexWorld, type World, type WorldPlayer } from '../src/shared/career/world';
import type { Pos } from '../src/shared/players';

const SHAPE: Pos[] = ['GK', 'GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'LB', 'RB', 'CDM', 'CDM', 'CM', 'CM', 'CM', 'CAM', 'CM', 'LW', 'RW', 'LW', 'RW', 'ST', 'ST', 'ST', 'ST', 'CB', 'CAM'];

export function makeWorld(perClub = 26) {
  const clubs: World['clubs'] = [];
  const players: WorldPlayer[] = [];
  for (let c = 0; c < 32; c++) {
    const id = `t${String(c).padStart(2, '0')}`;
    const league = c < 16 ? 1 : 2;
    clubs.push({ id, name: `Club ${id.toUpperCase()}`, country: 'BA', league, colors: null });
    const strength = (league === 1 ? 68 : 62) - (c % 16) * 0.4;
    for (let i = 0; i < perClub; i++) {
      const pos = SHAPE[i % SHAPE.length]!;
      const ovr = Math.round((strength + ((i * 7 + c * 3) % 11) - 5) * 10) / 10;
      players.push({ id: `${id}-p${String(i).padStart(2, '0')}`, name: `Player ${id} ${i}`, nat: 'BIH', pos, ovr, age: 19 + ((i * 5 + c) % 17), club: id, no: i + 1 });
    }
  }
  return indexWorld({ clubs, players });
}
