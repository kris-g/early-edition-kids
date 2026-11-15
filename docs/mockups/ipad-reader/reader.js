/* Early Edition on iPad: prototype. Sample paper, two reading modes, no server.
   URL options: ?mode=pages|scroll  &age=6|8|10  &screen=front|story|finished  &story=1..6  &page=1..n
   Keys: left/right turn pages, M switches reading mode. */

const COMMONS = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/';
const photo = (path, alt, caption, credit, pos) => ({ src: COMMONS + path, alt, caption, credit, pos: pos || '50% 50%' });

// Sample stories. The headlines come from the Kindle screens; the text is stand-in copy, not real reporting.
const STORIES = [
  {
    topic: 'football', topicName: 'Football', minutes: 2, source: 'BBC Newsround',
    title: 'Harry Kane breaks England’s caps record',
    teaser: 'England’s captain makes history at Wembley!',
    photo: photo('f/fd/Pitch_side_view_-_Wembley_Stadium_-_geograph.org.uk_-_4624558.jpg/1280px-Pitch_side_view_-_Wembley_Stadium_-_geograph.org.uk_-_4624558.jpg',
      'The pitch and stands at Wembley Stadium', 'Wembley Stadium in London, where England play their home matches.', 'Paul Gillett, CC BY-SA 2.0'),
    body: [
      'Harry Kane has now played more matches for England than any other player in history.',
      'The England captain walked out at Wembley to a huge roar. Fans all around the ground held up signs with his name on them.',
      'Kane first played for England when he was 21. He scored with one of his first touches of the ball, and he has been scoring ever since. He is also England’s top goalscorer of all time.',
      'After the final whistle, his team-mates lined up and clapped him off the pitch. Kane waved to the crowd and gave his shirt to a young fan.',
      'Kane says he is not finished yet. He wants to lead England at the next World Cup.',
    ],
    word: ['Cap', 'A cap is counted each time a player plays a match for their country.'],
    think: 'If you could give Harry Kane a special gift to celebrate his record, what would you choose?',
  },
  {
    topic: 'football', topicName: 'Football', minutes: 2, source: 'BBC Sport',
    title: 'Ronaldinho, 46, set to play again',
    teaser: 'The Brazil legend is chasing one last goal in Italy',
    photo: photo('2/29/2015_03_09_Shangani_Football_Match-7_%2816584782510%29.jpg/1280px-2015_03_09_Shangani_Football_Match-7_%2816584782510%29.jpg',
      'Footballers chasing the ball during a match', 'Players chase the ball during a match.', 'AMISOM, CC0'),
    body: [
      'Ronaldinho is one of the most famous footballers of all time, and he is about to play again.',
      'The Brazil legend is 46 years old. Most players stop long before that age, but he has agreed to join a team in Italy for a special match.',
      'Ronaldinho was known for his tricks, his no-look passes and his big smile. He won the World Cup with Brazil and was named the best player in the world.',
      'He says he still loves the game and wants to score one more goal in front of a crowd.',
      'Fans have already been queuing for tickets. Many of them were not even born when he was at his best.',
    ],
    word: ['Legend', 'A legend is someone who is famous for being very good at something for a long time.'],
    think: 'Which trick would you most like to learn with a football?',
  },
  {
    topic: 'science', topicName: 'Science', minutes: 2, source: 'BBC science',
    title: 'Forever chemicals drop in England’s rivers',
    teaser: 'Good news for fish as harmful chemicals fall',
    photo: photo('3/3c/River_Thames_and_Port_Meadow_from_Godstow_Lock.jpg/1280px-River_Thames_and_Port_Meadow_from_Godstow_Lock.jpg',
      'A wide, calm river running through green meadows', 'The River Thames near Oxford.', 'AstacopsisGouldi, CC BY-SA 4.0'),
    body: [
      'There is good news for the fish, birds and otters that live in England’s rivers.',
      'Scientists have been testing river water for “forever chemicals”. These are chemicals made by people that take a very long time to break down. They have been used in things like non-stick pans and waterproof coats.',
      'The new tests show that the amount of some of these chemicals in rivers is going down.',
      'Scientists think this is because several of the chemicals were banned, so factories stopped using them.',
      'There is still work to do. Some chemicals are still found in the water, and the scientists will keep testing every year.',
    ],
    word: ['Banned', 'When something is banned, a rule says nobody is allowed to use it.'],
    think: 'What could you do to help keep a river near you clean?',
  },
  {
    topic: 'space', topicName: 'Space', minutes: 2, source: 'BBC Newsround',
    title: 'SpaceX tries to catch a whole rocket',
    teaser: 'Giant “chopsticks” will try to grab a rocket mid-air!',
    photo: photo('e/e0/Space_X_booster_Full_Stack.jpg/1280px-Space_X_booster_Full_Stack.jpg',
      'A very tall rocket standing beside its launch tower', 'A SpaceX rocket stands beside its launch tower.', 'Jenny Hautmann, CC BY-SA 4.0'),
    body: [
      'Imagine catching something as tall as a tower block as it falls from the sky.',
      'That is what the rocket company SpaceX wants to do. Its newest rocket is the biggest ever built. After it launches, the bottom part, called the booster, flies back down to Earth.',
      'Waiting for it is a giant tower with two metal arms. People call the arms “chopsticks”. They close around the booster and hold it just above the ground.',
      'Catching a rocket means it can be used again instead of being thrown away. That makes each trip to space much cheaper.',
      'SpaceX hopes rockets like this will one day carry people to the Moon and to Mars.',
    ],
    word: ['Booster', 'The booster is the part of a rocket that pushes it off the ground.'],
    think: 'What would you send into space if you had your own rocket?',
  },
  {
    topic: 'animals', topicName: 'Animals and nature', minutes: 2, source: 'BBC Newsround', read: true,
    title: 'Rescuers warm up chilly sea turtles',
    teaser: 'Meet the cold turtle who got a royal new name!',
    photo: photo('e/e9/Green_turtle_swimming_out_for_a_breath_at_the_GBR.jpg/1280px-Green_turtle_swimming_out_for_a_breath_at_the_GBR.jpg',
      'A green sea turtle swimming up through blue water', 'A green sea turtle swims up for a breath of air.', 'Ppmh21, CC BY-SA 4.0'),
    body: [
      'A group of sea turtles are getting warm again after being found in very cold water.',
      'Sea turtles cannot make their own body heat. When the sea gets too cold, they slow down and can no longer swim. This is called being cold-stunned.',
      'Rescuers found the turtles floating near the shore and carried them to an animal hospital. There, vets are warming them up a little at a time in pools of water.',
      'One of the smallest turtles has been given a royal new name by the people looking after it.',
      'When the turtles are strong enough, they will be taken back to warmer seas and set free.',
    ],
    word: ['Cold-stunned', 'An animal is cold-stunned when it gets so cold that it can hardly move.'],
    think: 'What name would you give a rescued turtle?',
  },
  {
    topic: 'games', topicName: 'Games and tech', minutes: 2, source: 'BBC Newsround',
    title: 'Big Microsoft problem stops Xbox gamers',
    teaser: 'Why couldn’t gamers log in or save their games?',
    photo: null, // a story with no photo: the section colour opens it instead
    body: [
      'Lots of gamers switched on their Xbox and found that nothing worked.',
      'A problem at Microsoft, the company that makes the Xbox, stopped people from logging in. Some players could not start their games, and others could not save them.',
      'The problem was not inside the consoles. It was in the big computers, called servers, that the games talk to over the internet.',
      'Microsoft’s engineers worked to fix it, and after a few hours most players could get back to their games.',
      'The company said sorry and promised to find out what went wrong.',
    ],
    word: ['Server', 'A server is a powerful computer that sends information to lots of other computers.'],
    think: 'What do you like to do when the internet stops working?',
  },
].map((s, i) => ({ ...s, i }));

const PAPER = { date: 'Friday 13 November 2026', short: '13 NOV', number: 7, title: 'Early Edition' };

// The Kindle's own icons (plugin/earlyeditionkids.koplugin/icons), redrawn with currentColor.
const RING = '<circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="2.5"/>';
const ICONS = {
  football: ['0 0 48 48', RING + '<path d="M24 15l7 5-3 8h-8l-3-8z" fill="currentColor"/><path d="M24 15V6M31 20l8-4M28 28l5 8M20 28l-5 8M17 20l-8-4" stroke="currentColor" stroke-width="2.5" fill="none"/>'],
  science: ['0 0 48 48', RING + '<path d="M20 12h8M21 12v9l-7 13a2 2 0 0 0 2 3h16a2 2 0 0 0 2-3l-7-13v-9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M17 30h14" stroke="currentColor" stroke-width="2.5"/>'],
  space: ['0 0 48 48', RING + '<path d="M24 9c5 4 7 10 6 18h-12c-1-8 1-14 6-18z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><circle cx="24" cy="19" r="2.5" fill="currentColor"/><path d="M18 24l-4 5v4l5-3M30 24l4 5v4l-5-3M22 31l2 6 2-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>'],
  animals: ['0 0 48 48', RING + '<ellipse cx="24" cy="29" rx="7" ry="6" fill="currentColor"/><circle cx="15" cy="21" r="3" fill="currentColor"/><circle cx="20" cy="15" r="3" fill="currentColor"/><circle cx="28" cy="15" r="3" fill="currentColor"/><circle cx="33" cy="21" r="3" fill="currentColor"/>'],
  games: ['0 0 48 48', RING + '<rect x="11" y="18" width="26" height="14" rx="7" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M17 22v6M14 25h6" stroke="currentColor" stroke-width="2.5"/><circle cx="30" cy="23" r="1.8" fill="currentColor"/><circle cx="33" cy="27" r="1.8" fill="currentColor"/>'],
  tick: ['0 0 48 48', '<circle cx="24" cy="24" r="21" fill="#121212" stroke="#fafaf7" stroke-width="3"/><path d="M14 25l7 7 13-14" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'],
  arrow: ['0 0 24 24', '<path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'],
  back: ['0 0 24 24', '<path d="M19 12H6M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'],
  down: ['0 0 24 24', '<path d="M12 5v13M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'],
  sun: ['0 0 220 92', '<path d="M78 80 A32 32 0 0 1 142 80" fill="#ffd21f" stroke="#121212" stroke-width="4"/><path d="M60 80 A50 50 0 0 1 160 80" fill="none" stroke="#121212" stroke-width="4"/><path d="M10 80h200M110 6v14M56 26l10 10M164 26l-10 10M28 56l14 4M192 56l-14 4" stroke="#121212" stroke-width="4" stroke-linecap="round"/>'],
  sunInk: ['0 0 220 92', '<path d="M78 80 A32 32 0 0 1 142 80" fill="#121212"/><path d="M60 80 A50 50 0 0 1 160 80" fill="none" stroke="#121212" stroke-width="6"/><path d="M10 80h200M110 6v14M56 26l10 10M164 26l-10 10M28 56l14 4M192 56l-14 4" stroke="#121212" stroke-width="6" stroke-linecap="round"/>'],
  stamp: ['0 0 120 120', `<g transform="rotate(-8 60 60)"><circle cx="60" cy="60" r="56" fill="none" stroke="#121212" stroke-width="4"/><circle cx="60" cy="60" r="47" fill="none" stroke="#121212" stroke-width="1.5" stroke-dasharray="3 4"/><path d="M60 16l5.500 11.200 12.300 1.800-8.900 8.700 2.100 12.300L60 44.200 49 50l2.100-12.300-8.900-8.700 12.300-1.800z" fill="#121212"/><path d="M34 76V61h10v7.500H34M37.750 68.500L44 76M58 61H48v15h10M48 68.500h7.500M62 76l5-15 5 15M63.750 71h6.500M76 61h6.250L86 64.750v7.500L82.250 76H76V61" fill="none" stroke="#121212" stroke-width="3" stroke-linecap="square"/><text x="60" y="95" text-anchor="middle" font-family="Noto Sans, sans-serif" font-weight="700" font-size="11.500" letter-spacing="1.500" fill="#121212">${PAPER.short}</text></g>`],
};
const icon = (name, cls = '') => {
  const [box, body] = ICONS[name] || ICONS.football;
  return `<svg class="${cls}" viewBox="${box}" aria-hidden="true">${body}</svg>`;
};

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const stage = $('#stage');
const query = new URLSearchParams(location.search);

const state = {
  mode: query.get('mode') === 'scroll' ? 'scroll' : 'pages',
  screen: 'front', // 'front' | 'story'
  story: 0,
  page: 0,
  pages: 1,
  finished: false,
};
const age = Number(query.get('age')) || 8;
document.body.classList.add(age <= 6 ? 'age-young' : age >= 9 ? 'age-older' : 'age-mid');

const readCount = () => STORIES.filter((s) => s.read).length;
const landscape = () => window.matchMedia('(orientation: landscape)').matches;
const nextUnread = (from) => {
  for (let k = 1; k <= STORIES.length; k++) {
    const s = STORIES[(from + k) % STORIES.length];
    if (!s.read) return s;
  }
  return null;
};
const tally = () =>
  `<p class="tally"><span class="pips" aria-hidden="true">${STORIES.map((s, k) => `<i class="${k < readCount() ? 'on' : ''}"></i>`).join('')}</span>${readCount()} of ${STORIES.length} read</p>`;
const img = (s) =>
  `<img src="${s.photo.src}" alt="${s.photo.alt}" style="object-position:${s.photo.pos}" onerror="noPhoto(${s.i})" draggable="false">`;

/** A photo that fails to load is treated as a story with no photo, as the real reader would. */
window.noPhoto = (i) => {
  if (!STORIES[i].photo) return;
  STORIES[i].photo = null;
  render();
};

// ---------- the running head on a story: the way back, and where you are ----------
const place = () =>
  `Story ${state.story + 1} of ${STORIES.length}<span class="pips" aria-hidden="true">${STORIES.map((s) => `<i class="${s.i === state.story ? 'now' : ''}"></i>`).join('')}</span>`;
const runhead = () =>
  `<header class="runhead"><button class="home" data-go="front">${icon('back')}Front page</button><p class="word">${PAPER.title}</p><p class="place" id="place">${place()}</p></header>`;
function updateHead() {
  const el = $('#place');
  if (el) el.innerHTML = place();
}

// ---------- front page ----------
function renderFront() {
  const done = readCount() === STORIES.length;
  const lead = STORIES.find((s) => !s.read) || STORIES[0];
  const minutes = STORIES.reduce((n, s) => n + s.minutes, 0);
  const rest = STORIES.filter((s) => s !== lead);
  stage.innerHTML = `
    <section class="front">
      <div class="dateline"><span>${PAPER.date}</span><span class="sample">Sample stories</span><span>No. ${PAPER.number}</span></div>
      <header class="mast">
        ${icon('sun', 'sun')}
        <h1>${PAPER.title}</h1>
        <p class="tag">The news, written for you</p>
      </header>
      <div class="front-main">
        <article class="lead" data-topic="${lead.topic}">
          <figure class="lead-photo" data-go="${lead.i}">
            ${lead.photo ? img(lead) : icon(lead.topic)}
            <span class="flag">${icon(lead.topic)}${lead.topicName} · ${lead.minutes} minute read</span>
          </figure>
          <h2 data-go="${lead.i}">${lead.title}</h2>
          <p class="teaser">${lead.teaser}</p>
          <div class="actions">
            <button class="btn go" data-go="${lead.i}">${done ? 'Read it again' : 'Start reading'} ${icon('arrow')}</button>
            <div class="facts">${tally()}<p class="meta">${done ? 'You have read all of today’s paper' : `${STORIES.length} stories · about ${minutes} minutes`}</p></div>
          </div>
        </article>
        <ol class="inside">
          ${rest
            .map(
              (s) => `<li><button class="row${s.read ? ' read' : ''}" data-go="${s.i}" data-topic="${s.topic}">
                <span class="thumb">${s.photo ? img(s) : icon(s.topic)}${s.read ? icon('tick', 'tick') : ''}</span>
                <span><strong>${s.title}</strong><span class="meta">${s.topicName} · ${s.read ? 'Read' : s.minutes + ' min'}</span></span>
              </button></li>`,
            )
            .join('')}
          <li class="furniture"><button class="btn" data-note="Back issues">Back issues</button><button class="btn" data-note="My week">My week</button></li>
        </ol>
      </div>
    </section>`;
}

// ---------- story parts shared by both modes ----------
function opener(s) {
  if (!s.photo) {
    return `<div class="opener plain">${icon(s.topic)}<h1 class="headline">${s.title}</h1><p class="label">${s.topicName} · ${s.minutes} minute read</p></div>`;
  }
  return `<figure class="opener">
    <div class="shot">${img(s)}<span class="flag">${icon(s.topic)}${s.topicName} · ${s.minutes} minute read</span></div>
    <figcaption><span class="cap">${s.photo.caption}</span> <span class="credit">Photo: ${s.photo.credit}</span></figcaption>
  </figure>`;
}
const body = (s) =>
  s.body.map((p) => `<p class="para">${p}</p>`).join('') +
  `<aside class="box word"><h2>Word to know</h2><p><b>${s.word[0]}</b>: ${s.word[1]}</p></aside>
   <aside class="box think"><h2>Think about it</h2><p>${s.think}</p></aside>
   <p class="source">Source: ${s.source}</p>`;

// ---------- a story, in pages ----------
function renderPaged() {
  const s = STORIES[state.story];
  stage.innerHTML = `
    <article class="story paged" data-topic="${s.topic}">
      ${runhead()}
      <div class="pager" id="pager"><div class="flow" id="flow">
        ${opener(s)}${s.photo ? `<h1 class="headline">${s.title}</h1>` : ''}${body(s)}
      </div></div>
      <footer class="turner">
        <button class="turn prev" data-turn="-1" aria-label="Page back">${icon('back')}</button>
        <p class="where" aria-live="polite"><span id="where"></span><span class="dots" id="dots" aria-hidden="true"></span></p>
        <button class="turn next" data-turn="1"><span id="nextLabel">Next page</span>${icon('arrow')}</button>
      </footer>
    </article>`;
  layoutPages();
  if (state.finished) showFinished(false);
}

function layoutPages() {
  const pager = $('#pager');
  const flow = $('#flow');
  if (!pager || !flow) return;
  const cols = landscape() ? 2 : 1;
  const w = pager.clientWidth;
  const h = pager.clientHeight;
  flow.style.setProperty('--cols', cols);
  // Portrait: the photo takes the top of page one. Landscape: it fills the left-hand page.
  flow.style.setProperty('--shot-h', Math.round(cols === 2 ? h - 66 : h * 0.4) + 'px');
  flow.style.setProperty('--plain-h', '0px');
  // In a spread the opener is exactly one page tall (the flow's padding is 30 above and 22 below).
  flow.style.setProperty('--opener-h', h - 24 + 'px');
  state.pages = Math.max(1, Math.ceil(flow.scrollWidth / w - 0.02));
  state.page = Math.min(state.page, state.pages - 1);
  flow.style.transform = `translateX(${-state.page * w}px)`;
  $('#where').textContent = `Page ${state.page + 1} of ${state.pages}`;
  $('#dots').innerHTML = Array.from({ length: state.pages }, (_, k) => `<i class="${k === state.page ? 'on' : ''}"></i>`).join('');
  $('.turn.prev').disabled = state.page === 0;
  $('#nextLabel').textContent = state.page === state.pages - 1 ? 'Finish' : 'Next page';
}

function turn(by) {
  if (state.screen !== 'story' || state.mode !== 'pages') return;
  if (state.finished) {
    if (by < 0) { state.finished = false; $('.finished')?.remove(); }
    return;
  }
  const to = state.page + by;
  if (to < 0) return;
  if (to >= state.pages) return finish();
  state.page = to;
  $('#flow').classList.add('turning');
  layoutPages();
}

function finish() {
  STORIES[state.story].read = true;
  state.finished = true;
  updateHead();
  showFinished(true);
}

function showFinished(animate) {
  $('.finished')?.remove();
  const s = STORIES[state.story];
  const next = nextUnread(s.i);
  const el = document.createElement('section');
  el.className = 'finished' + (next ? '' : ' paper-done') + (animate ? ' enter' : '');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Story finished');
  el.innerHTML = `
    <div class="fin-head">
      <div class="stamp${animate ? ' land' : ''}">${icon('stamp')}</div>
      <div><h2>${next ? 'Story finished!' : 'Paper finished!'}</h2>${tally()}</div>
    </div>
    ${
      next
        ? `<button class="next-story" data-go="${next.i}" data-topic="${next.topic}">
            <span class="disc">${icon(next.topic)}</span>
            <span><strong>${next.title}</strong><span class="meta">Next story · ${next.topicName} · ${next.minutes} min</span></span>
            ${icon('arrow')}
          </button>`
        : `<div class="actions"><button class="btn go" data-go="front">Front page ${icon('arrow')}</button><button class="btn" data-note="My week">My week</button></div>`
    }`;
  stage.appendChild(el);
}

// ---------- a story, scrolling: one long paper ----------
function renderLong() {
  stage.innerHTML = `<div class="scroller">${runhead()}<div class="long" id="long">
    ${STORIES.map((s) => {
      const next = STORIES[s.i + 1];
      return `<article class="story" id="story-${s.i}" data-topic="${s.topic}">
        <div class="side">${opener(s)}</div>
        <div class="reel${s.photo ? '' : ' after-plain'}">
          ${s.photo ? `<h1 class="headline">${s.title}</h1>` : ''}${body(s)}
          <div class="fin-inline${s.read ? '' : ' waiting'}" data-fin="${s.i}">
            <div class="stamp">${icon('stamp')}</div>
            <div><h2>Story finished!</h2><span class="tally-slot">${tally()}</span>
            <p class="onward">${next ? `Next: ${next.title}` : 'That was the last story.'}</p></div>
          </div>
        </div>
      </article>`;
    }).join('')}
    <section class="closer">
      <h2>That’s today’s paper</h2>
      <span class="tally-slot">${tally()}</span>
      <div class="actions">
        <button class="btn go" data-go="front">Front page ${icon('arrow')}</button>
        <button class="btn" data-note="Back issues">Back issues</button>
        <button class="btn" data-note="My week">My week</button>
      </div>
    </section>
  </div></div>`;
  const long = $('#long');
  long.style.setProperty('--stage-h', long.clientHeight + 'px');
  // Where a story starts within the scrolling area (offsetTop is measured from the stage, which includes the running head).
  const topOf = (i) => $(`#story-${i}`).offsetTop - long.offsetTop;
  long.scrollTop = topOf(state.story);

  // A story is read when its end comes into view; the stamp lands then.
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const s = STORIES[Number(e.target.dataset.fin)];
        if (s.read) continue;
        s.read = true;
        e.target.classList.remove('waiting');
        $('.stamp', e.target).classList.add('land');
        long.querySelectorAll('.tally-slot').forEach((slot) => (slot.innerHTML = tally()));
        updateHead();
      }
    },
    { root: long, threshold: 0.9 },
  );
  long.querySelectorAll('.fin-inline.waiting').forEach((el) => seen.observe(el));

  // The running head follows the story on screen.
  let queued = false;
  long.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const line = long.scrollTop + long.clientHeight * 0.4;
      let now = 0;
      for (const s of STORIES) if (topOf(s.i) <= line) now = s.i;
      if (now !== state.story) { state.story = now; updateHead(); }
    });
  });
}

// ---------- moving about ----------
function render() {
  app.dataset.mode = state.mode;
  app.dataset.screen = state.screen;
  updateHead();
  if (state.screen === 'front') renderFront();
  else if (state.mode === 'pages') renderPaged();
  else renderLong();
}

function go(where) {
  if (where === 'front') state.screen = 'front';
  else {
    const i = Number(where);
    if (state.screen === 'story' && state.mode === 'scroll') {
      state.story = i;
      $('#long').scrollTo({ top: $(`#story-${i}`).offsetTop - $('#long').offsetTop, behavior: 'smooth' });
      return updateHead();
    }
    state.screen = 'story';
    state.story = i;
  }
  state.page = 0;
  state.finished = false;
  render();
}

function note(what) {
  $('.note')?.remove();
  const el = document.createElement('p');
  el.className = 'note';
  el.setAttribute('role', 'status');
  el.textContent = `${what} isn’t drawn in this mock-up yet.`;
  stage.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go],[data-turn],[data-note]');
  if (t) {
    if (t.dataset.go !== undefined) go(t.dataset.go);
    else if (t.dataset.turn) turn(Number(t.dataset.turn));
    else note(t.dataset.note);
    return;
  }
  // Tapping the outer thirds of a page turns it.
  const pager = e.target.closest('#pager');
  if (pager && !state.finished) {
    const x = (e.clientX - pager.getBoundingClientRect().left) / pager.clientWidth;
    if (x > 0.67) turn(1);
    else if (x < 0.33) turn(-1);
  }
});

// Swipe sideways to turn.
let downX = null;
stage.addEventListener('pointerdown', (e) => { downX = e.clientX; });
stage.addEventListener('pointerup', (e) => {
  if (downX === null) return;
  const dx = e.clientX - downX;
  downX = null;
  if (Math.abs(dx) > 60) { turn(dx < 0 ? 1 : -1); e.preventDefault(); stage.addEventListener('click', (c) => c.stopPropagation(), { capture: true, once: true }); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') turn(1);
  else if (e.key === 'ArrowLeft') turn(-1);
  else if (e.key === 'm' || e.key === 'M') { state.mode = state.mode === 'pages' ? 'scroll' : 'pages'; state.finished = false; state.page = 0; render(); }
});

let resizing;
window.addEventListener('resize', () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => {
    if (state.screen === 'story' && state.mode === 'pages') { $('#flow')?.classList.remove('turning'); layoutPages(); }
    else render();
  }, 80);
});

// Deep links for looking at one state.
if (query.get('all')) STORIES.forEach((s) => (s.read = true)); // ?all=1: the whole paper read
const wanted = query.get('screen');
if (wanted === 'story' || wanted === 'finished') {
  state.screen = 'story';
  state.story = Math.min(STORIES.length, Math.max(1, Number(query.get('story')) || 1)) - 1;
  state.page = Math.max(0, (Number(query.get('page')) || 1) - 1);
  if (wanted === 'finished') { STORIES[state.story].read = true; state.finished = true; state.page = 99; }
}
render();
if (document.fonts?.ready) document.fonts.ready.then(() => state.screen === 'story' && state.mode === 'pages' && layoutPages());
