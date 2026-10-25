# Nova Drift — Milky Way Explorer

A browser idle/incremental game about exploring the Milky Way — built to reward you for stepping away and studying, not for sitting and grinding.

Play it by opening `index.html` in a browser, or host it on GitHub Pages.

## How it works

- **Mine asteroids** by clicking them with your mining laser for instant Stardust and Energy.
- **Upgrade your ship** — Solar Collector, Energy Reactor, Mining Laser, and Cargo Expansion — to grow your passive income and offline range.
- **Explore planets** along the Galaxy Map, in order, to unlock permanent bonuses and rank up from Rookie Pilot to Galaxy Explorer.
- **Walk away and come back.** The longer you're gone, the bigger the idle bonus on return (an exponential multiplier, capped by your Cargo Range upgrade) — short gaps barely matter, but a real break pays off.
- **Fatigue is real.** Stay actively playing for too long in one sitting and your crew gets tired — collection rates and laser power gradually drop. A banner will nudge you toward a break well before it gets bad.
- **Built-in Pomodoro.** Start a focus session from the Focus Mode panel and the game fully pauses — asteroids stop spawning, resources stop ticking — while you study. When the timer ends (even if you closed the tab), you get a reward burst and your crew's fatigue resets, satisfying the itch to check back in without ever competing with the thing you're supposed to be doing.
- **Local save folder (optional).** In supported browsers (Chrome/Edge), click "Link Save Folder" to sync your save (`novadrift-save.json`) and a human-readable `mission-log.txt` directly to a folder on your computer. Everywhere else, use Export/Import for a manual JSON backup.

## Tech

Plain HTML/CSS/JS, no build step, no dependencies. State persists to `localStorage` and autosaves every 10 seconds.

## Credits

Built with [Claude Code](https://claude.com/claude-code).
