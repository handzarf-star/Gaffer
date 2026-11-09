import { BRAND } from '../../shared/brand';
import { Button } from '../components/ui';
import { navigate } from '../lib/hooks';

export function HowTo() {
  return (
    <article className="howto">
      <p className="eyebrow">How to play</p>
      <h1>Draft. Argue. Settle it.</h1>
      <p className="lead">{BRAND.name} takes about a minute to learn. You draft eleven footballers, set your tactics, and a match engine plays the game out.</p>

      <section>
        <h2>1. Pick a way to play</h2>
        <p><b>Play a friend</b> makes a private room with a 4-letter code and a share link. Up to four players. <b>Solo Cup</b> is a four-round knockout against AI sides. <b>Daily Draft</b> gives everyone the same packs for the day.</p>
      </section>
      <section>
        <h2>2. Draft eleven players</h2>
        <p>There are 11 rounds. In a <b>Duel</b> draft one board of cards is shared: you take turns, and once a card is taken it is gone, so you can steal your mate's target. In a <b>Packs</b> draft everyone opens their own pack of three at the same time.</p>
        <p>Tap a card, then tap a spot on the pitch (or press Enter to use the suggested spot). Double-tap a card to place it straight away. Number keys 1 to 8 pick cards too.</p>
      </section>
      <section>
        <h2>3. Mind the fit</h2>
        <p>Spots light up with how well the player suits them: <b>✓ natural</b>, <b>≈ close</b>, <b>! a stretch</b>, <b>✕ out of position</b>. Out of position costs rating points, so a striker in goal is a bad idea. The "Still need" strip shows which positions you have left to fill.</p>
      </section>
      <section>
        <h2>4. Build chemistry</h2>
        <p>Teammates from the <b>same nation</b> who stand next to each other on the pitch are linked. Linked players play a little better.</p>
      </section>
      <section>
        <h2>5. Pick your tactics</h2>
        <p>After the draft pick a formation and one of five tactics: Possession, High Press, Wide Attack, Fortress or Counter. Each has a clear trade-off. Your rival cannot see your choices until kick-off.</p>
      </section>
      <section>
        <h2>6. Watch it play out</h2>
        <p>The engine compares attack, midfield, defence and keepers, adds some luck, and plays 90 minutes: chances, saves, cards, goals, extra time and penalties. Better squads win more often, but upsets always happen. Both players see the same match at the same time, and you can skip to the end.</p>
      </section>
      <section>
        <h2>If something goes wrong</h2>
        <ul>
          <li>Lost your connection? Keep the page open. It reconnects by itself and your seat is saved.</li>
          <li>Closed the tab? Open the same link on the same device and you are back in.</li>
          <li>Someone went AFK? After a few seconds the draft auto-picks for them so nobody is stuck.</li>
        </ul>
      </section>
      <section className="legal">
        <h2>About the players and ratings</h2>
        <p>{BRAND.name} is an independent fan game. It is not affiliated with or endorsed by any player, club, league, federation or data provider. Player names are used only to identify the footballers. There are no photos, likenesses, club badges, kits or official imagery. Ratings are our own rough opinions of players at their peak, for fun, and are not official records or betting advice.</p>
      </section>
      <div className="row"><Button variant="primary" size="lg" onClick={() => navigate('/')}>Let's play</Button></div>
    </article>
  );
}
