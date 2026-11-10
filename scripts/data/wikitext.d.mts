export interface SquadRow {
  name: string; link: string | null; no: number | null; pos: string | null; nat: string | null;
  note: string | null; captain: boolean; loanFrom: string | null;
}
export function splitArgs(s: string): string[];
export function findTemplates(text: string, nameRe: string): { at: number; raw: string }[];
export function cleanName(raw: string | undefined): { name: string; link: string | null };
export function plainNote(raw: string | undefined): string;
export function parseFsPlayer(inner: string): SquadRow | null;
export function parseSquad(wikitext: string): {
  rows: (SquadRow & { section: 'squad' | 'loanedOut' })[];
  skipped: { section: string; name: string }[];
};
export function fold(s: string): string;
export interface Infobox {
  born: string | null; bornPrecision: 'day' | null; position: string | null; currentClub: string | null;
  clubApps: number | null; clubGoals: number | null; clubLines: number;
  intlCaps: number | null; intlGoals: number | null; nationalTeams: string[];
}
export function parseInfobox(wikitext: string): Infobox | null;
