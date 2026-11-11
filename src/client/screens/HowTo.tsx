import { BRAND } from '../../shared/brand';
import { Button } from '../components/ui';
import { navigate } from '../lib/hooks';
import { useI18n } from '../lib/i18n';

/** Renders a translated sentence that carries <b>bold</b> parts. Each language keeps its own word order, so the markers live inside the text. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(<b>.*?<\/b>)/g).map((part, i) => (/^<b>.*<\/b>$/.test(part) ? <b key={i}>{part.slice(3, -4)}</b> : part))}</>;
}

export function HowTo() {
  const { t } = useI18n();
  return (
    <article className="howto">
      <p className="eyebrow">{t('How to play')}</p>
      <h1>{t('Draft. Argue. Settle it.')}</h1>
      <p className="lead">{t('{brand} takes about a minute to learn. You draft eleven footballers, set your tactics, and a match engine plays the game out.', { brand: BRAND.name })}</p>

      <section>
        <h2>{t('1. Pick a way to play')}</h2>
        <p><Rich text={t('<b>Play a friend</b> makes a private room with a 4-letter code and a share link. Up to four players. <b>Solo Cup</b> is a four-round knockout against AI sides. <b>Daily Draft</b> gives everyone the same packs for the day.')} /></p>
      </section>
      <section>
        <h2>{t('2. Draft eleven players')}</h2>
        <p><Rich text={t("There are 11 rounds. In a <b>Duel</b> draft one board of cards is shared: you take turns, and once a card is taken it is gone, so you can steal your mate's target. In a <b>Packs</b> draft everyone opens their own pack of three at the same time.")} /></p>
        <p>{t('Tap a card, then tap a spot on the pitch (or press Enter to use the suggested spot). Double-tap a card to place it straight away. Number keys 1 to 8 pick cards too.')}</p>
      </section>
      <section>
        <h2>{t('3. Mind the fit')}</h2>
        <p><Rich text={t('Spots light up with how well the player suits them: <b>✓ natural</b>, <b>≈ close</b>, <b>! a stretch</b>, <b>✕ out of position</b>. Out of position costs rating points, so a striker in goal is a bad idea. The "Still need" strip shows which positions you have left to fill.')} /></p>
      </section>
      <section>
        <h2>{t('4. Build chemistry')}</h2>
        <p><Rich text={t('Teammates from the <b>same nation</b> who stand next to each other on the pitch are linked. Linked players play a little better.')} /></p>
      </section>
      <section>
        <h2>{t('5. Pick your tactics')}</h2>
        <p>{t('After the draft pick a formation and one of five tactics: Possession, High Press, Wide Attack, Fortress or Counter. Each has a clear trade-off. Your rival cannot see your choices until kick-off.')}</p>
        <p>{t('Tactics play rock, paper, scissors: High Press beats Possession, Possession beats Fortress, Fortress beats Counter and Counter beats High Press. Wide Attack is the neutral choice. Since your rival hides theirs, there is some guessing to do.')}</p>
      </section>
      <section>
        <h2>{t('6. Watch it play out')}</h2>
        <p>{t('The engine compares attack, midfield, defence and keepers, adds some luck, and plays 90 minutes: chances, saves, cards, goals, extra time and penalties. Better squads win more often, but upsets always happen. Both players see the same match at the same time, and you can skip to the end.')}</p>
      </section>
      <section>
        <h2>{t('If something goes wrong')}</h2>
        <ul>
          <li>{t('Lost your connection? Keep the page open. It reconnects by itself and your seat is saved.')}</li>
          <li>{t('Closed the tab? Open the same link on the same device and you are back in.')}</li>
          <li>{t('Someone went AFK? After a few seconds the draft auto-picks for them so nobody is stuck.')}</li>
        </ul>
      </section>
      <section className="legal">
        <h2>{t('About the players and ratings')}</h2>
        <p>{t('{brand} is an independent fan game. It is not affiliated with or endorsed by any player, club, league, federation or data provider. Player names are used only to identify the footballers. There are no photos, likenesses, club badges, kits or official imagery. Ratings are our own rough opinions of players at their peak, for fun, and are not official records or betting advice.', { brand: BRAND.name })}</p>
      </section>
      <div className="row"><Button variant="primary" size="lg" onClick={() => navigate('/')}>{t("Let's play")}</Button></div>
    </article>
  );
}
