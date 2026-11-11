// How cards are graded on this screen. Star pools use fixed thresholds; a league drafted from sourced squads grades its cards against
// its own pool (shared/pools.ts, poolBands), so the room hands its bands down to every card, pitch and pack under it.
import { createContext, useContext } from 'react';
import { STAR_BANDS, type TierBands } from '../../shared/players';

const Ctx = createContext<TierBands>(STAR_BANDS);
export const TierProvider = Ctx.Provider;
export const useBands = (): TierBands => useContext(Ctx);
