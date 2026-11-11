// The checks written before League Night cover the older draft styles (Duel, Packs, Take turns) and competitions. They reach them the
// way a person does now: "Start a league" on the home page, then the Advanced drawer in the lobby.

/** click a toggle and wait until the server has applied it */
async function press(loc) {
  await loc.click();
  await loc.page().waitForFunction((el) => el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true', await loc.elementHandle(), { timeout: 8000 });
}
async function unpress(loc) {
  if ((await loc.getAttribute('aria-pressed')) !== 'true') return;
  await loc.click();
  await loc.page().waitForFunction((el) => el.getAttribute('aria-pressed') !== 'true', await loc.elementHandle(), { timeout: 8000 });
}

export async function createRoom(page) {
  await page.getByRole('button', { name: 'Start a league' }).click();
  await page.waitForURL(/\/r\/[A-Z]{4}$/);
  await page.locator('.lobby').waitFor();
}

export async function openAdvanced(page) {
  const adv = page.locator('details.advanced');
  if ((await adv.getAttribute('open')) === null) await adv.locator('summary').click();
  return adv;
}

/**
 * Put the lobby into one of the older set-ups. `stars`: draft from today's stars (the pool these checks were written for) instead
 * of the Balkan League. A league gets no transfer window unless `window` says so.
 */
export async function classic(page, { format = 'duel', competition = 'match', stars = true, window = false } = {}) {
  const adv = await openAdvanced(page);
  await press(adv.getByRole('button', { name: { match: /^Single match/, league: /^League/, groups: /^Groups/, knockout: /^Knockout/ }[competition] }));
  await press(adv.getByRole('button', { name: { duel: /^Duel/, packs: /^Packs/, turns: /^Take turns/, spotlight: /^Spotlight/ }[format] }));
  if (competition === 'league' && !window) await press(adv.getByRole('radiogroup', { name: 'Transfer window' }).getByRole('radio', { name: 'None' }));
  await press(adv.getByRole('radio', { name: 'Stars' }));
  if (stars) {
    await press(page.getByRole('button', { name: 'Everyone', exact: true }));
    await unpress(page.getByRole('button', { name: 'Balkan League', exact: true }));
    await press(page.getByRole('radio', { name: "Today's players only" }));
  }
}
