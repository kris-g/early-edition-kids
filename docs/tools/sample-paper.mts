// Seeds a data folder with sample papers for screenshots and videos of the iPad reader.
// The stories are made up and name no real people; the photos are openly licensed ones from
// Wikimedia Commons, downloaded when this runs and credited in docs/ipad.md.
//
// Usage, from server/:
//   EARLY_EDITION_KIDS_DATA_DIR=/tmp/eek-docs EARLY_EDITION_KIDS_CONFIG=../docs/tools/sample-config.yaml \
//     NODE_USE_ENV_PROXY=1 node --import tsx ../docs/tools/sample-paper.mts
// then start the server with the same data folder and LLM_BASE_URL=stub (no GENERATE_AT).

import { execFileSync } from "node:child_process";
import { dbPath, loadConfig, settingsFromEnv } from "../../server/src/config.js";
import { Database } from "../../server/src/db.js";
import { StubLLM } from "../../server/src/llm.js";
import { buildContext, storeIssue, type StoryRow } from "../../server/src/pipeline.js";
import { bodyToHtml } from "../../server/src/render.js";
import { addDays, londonDate } from "../../server/src/timeutil.js";

const COMMONS = "https://upload.wikimedia.org/wikipedia/commons/thumb/";
const PHOTOS = {
  stadium: COMMONS + "f/fd/Pitch_side_view_-_Wembley_Stadium_-_geograph.org.uk_-_4624558.jpg/1280px-Pitch_side_view_-_Wembley_Stadium_-_geograph.org.uk_-_4624558.jpg",
  match: COMMONS + "2/29/2015_03_09_Shangani_Football_Match-7_%2816584782510%29.jpg/1280px-2015_03_09_Shangani_Football_Match-7_%2816584782510%29.jpg",
  river: COMMONS + "3/3c/River_Thames_and_Port_Meadow_from_Godstow_Lock.jpg/1280px-River_Thames_and_Port_Meadow_from_Godstow_Lock.jpg",
  rocket: COMMONS + "e/e0/Space_X_booster_Full_Stack.jpg/1280px-Space_X_booster_Full_Stack.jpg",
  turtle: COMMONS + "e/e9/Green_turtle_swimming_out_for_a_breath_at_the_GBR.jpg/1280px-Green_turtle_swimming_out_for_a_breath_at_the_GBR.jpg",
} as const;

type Sample = {
  topic: string;
  title: string;
  teaser: string;
  body: string[];
  word: [string, string];
  think: string;
  photo?: keyof typeof PHOTOS;
  alt?: string;
};

// Today's paper, written for a 12-year-old (sample-config.yaml): longer stories that run to
// several pages on an iPad.
const TODAY: Sample[] = [
  {
    topic: "Football", photo: "stadium", alt: "A football pitch and empty red stands",
    title: "Big stadium opens its pitch to schools",
    teaser: "Hundreds of pupils play where the professionals do",
    body: [
      "For most young footballers, the closest they will ever get to the pitch of a national stadium is a seat high up in the stands. This week, more than four hundred pupils from forty schools got to walk out of the tunnel and play on it.",
      "The stadium usually hosts cup finals, international matches and concerts. Between big events, its grass needs careful looking after, so the ground staff rarely let anyone onto it. This time they made an exception, and the schools were chosen in a draw that more than a thousand had entered.",
      "Each school played two short matches across the width of the pitch, so that six games could run at once. The stands were empty, but the stadium's big screens showed every goal, and the announcer read out each scorer's name as if it were a final.",
      "Between matches, the teams were shown round the parts of the stadium that visitors normally never see: the changing rooms, the warm-up area under the stands, and the room where players give interviews after a game. Several pupils said the most surprising thing was how big and quiet the place felt with nobody in it.",
      "The organisers said the day was about more than football. They wanted pupils to see the jobs that keep a stadium running, from the groundskeepers who cut the grass to exactly the right height to the engineers who look after the floodlights and the stewards who keep crowds safe.",
      "One of the teachers said her class had talked about nothing else for weeks. Some of her pupils had never been to a professional match before, and now they could say they had scored on one of the most famous pitches in the country.",
      "The organisers hope to make it a yearly event, with a separate day for schools that have never entered a competition before.",
    ],
    word: ["Groundskeeper", "Someone whose job is to look after a sports pitch, especially the grass."],
    think: "Which job behind the scenes at a stadium would you most like to do, and why?",
  },
  {
    topic: "Football", photo: "match", alt: "Children chasing a football in a crowd",
    title: "Village team wins its first cup in 50 years",
    teaser: "A last-minute header and a party in the square",
    body: [
      "A village football team has won a cup for the first time in half a century, and almost everyone who lives there came out to celebrate.",
      "The team plays in a local league for amateur clubs. None of the players is paid: they include a farmer, two teachers, a nurse and several students home from university. They train twice a week under floodlights they raised the money for themselves, on a pitch next to the village hall.",
      "The final was played against a club from a nearby town that had won the cup three times in the last ten years. For most of the match it looked as if that record would continue. The village team went a goal down early on and spent long spells defending.",
      "With ten minutes left they finally equalised from a corner. Then, in the last minute, a long cross from the right wing found their tallest player at the far post, and his header flew into the top corner.",
      "The last time the village won the cup, the trophy spent a year in the window of the post office. This time the team carried it round the village on a tractor trailer, stopping outside the school, the shop and the care home so that people could see it.",
      "Among those watching was a man who had played in the winning team fifty years ago. He told the players that the cup felt just as heavy as he remembered.",
      "The club says it will use the prize money to start a team for younger players, so that the next win does not take another fifty years.",
    ],
    word: ["Amateur", "Someone who does something, such as a sport, for enjoyment rather than as a paid job."],
    think: "Why do you think a win like this means so much to a whole village, not just the players?",
  },
  {
    topic: "Science", photo: "river", alt: "A wide, calm river running through green meadows",
    title: "Rivers are getting cleaner, say scientists",
    teaser: "Some long-lasting chemicals are finally falling",
    body: [
      "There is some good news for the fish, birds and otters that live in rivers: the amount of certain harmful chemicals in the water is going down.",
      "For years, scientists have been testing river water for a group of man-made chemicals that take an extremely long time to break down. Because they last so long, they are sometimes nicknamed 'forever chemicals'. They have been used in things like non-stick frying pans, waterproof coats and some kinds of firefighting foam.",
      "The worry is that these chemicals build up over time. Small amounts can collect in the bodies of fish and the animals that eat them, and scientists are still working out exactly what effects that has.",
      "The latest tests, taken at hundreds of sites over several years, show that the levels of some of the oldest of these chemicals have fallen. The scientists think the main reason is that those chemicals were banned, so factories had to stop using them and switch to other materials.",
      "It is not all good news. Some newer chemicals in the same family are still found in the water, and because they break down so slowly, it will take many years for the old ones to disappear completely.",
      "The scientists say the results show that rules on what factories can use really do make a difference, and that it is important to keep testing so that problems are spotted early.",
      "They plan to test the same sites every year, and to add more rivers to the list.",
    ],
    word: ["Banned", "When something is banned, a rule or law says that nobody is allowed to use it."],
    think: "If a chemical is very useful but lasts a long time in nature, how should people decide whether to allow it?",
  },
  {
    topic: "Space", photo: "rocket", alt: "A very tall rocket standing beside its launch tower",
    title: "A rocket as tall as a tower block",
    teaser: "And a giant tower with arms that will try to catch it",
    body: [
      "Imagine trying to catch something as tall as a twenty-storey building as it falls out of the sky. That is the plan for one of the biggest rockets ever built.",
      "Most rockets are used only once. After launch, the lower part, called the booster, burns its fuel in the first few minutes of flight and then drops away, usually crashing into the sea. Building a new booster for every launch is one of the main reasons that going to space is so expensive.",
      "This rocket's booster is designed to fly itself back to the launch site instead. As it returns, it fires its engines again to slow down, steering itself towards a tower that stands beside the launch pad.",
      "The tower has two enormous metal arms. As the booster drops the last few metres, the arms swing together and grab it, holding it just above the ground. Engineers compare it to catching something with a pair of chopsticks.",
      "Catching the booster rather than landing it on legs means the rocket can be lighter, because it does not have to carry the legs into space. It also means the booster can be checked, refuelled and launched again much more quickly.",
      "It is a very difficult thing to get right. The booster has to arrive in exactly the right place at exactly the right speed, and the arms have to close at exactly the right moment.",
      "If it works regularly, rockets like this could make it much cheaper to launch satellites, telescopes and, one day, people heading to the Moon.",
    ],
    word: ["Booster", "The lower part of a rocket, which pushes it off the ground and through the first part of its flight."],
    think: "Why do you think reusing rockets could change what people are able to do in space?",
  },
  {
    topic: "Animals and nature", photo: "turtle", alt: "A green sea turtle swimming up through blue water",
    title: "Rescued sea turtles head back to sea",
    teaser: "They were too cold to swim when they were found",
    body: [
      "A group of young sea turtles are on their way home after being rescued from water that was far too cold for them.",
      "Sea turtles are reptiles, which means they cannot make their own body heat. Their bodies are about as warm as the water around them. When the sea suddenly gets colder, as it can in late autumn, turtles slow down until they can barely move. This is called being cold-stunned.",
      "A cold-stunned turtle cannot swim properly or find food, and it can be washed ashore by waves. Volunteers walk the beaches on cold days looking for them, because a turtle that is found quickly has a good chance of recovering.",
      "These turtles were carried to an animal hospital, where vets warmed them up very slowly, a few degrees a day. Warming a turtle too quickly can be dangerous, because its body needs time to adjust.",
      "Once they were warm, the vets checked each turtle for injuries and infections, gave them medicine where it was needed, and fed them until they were back to a healthy weight. Each turtle was also measured and fitted with a tiny tag, so scientists will know if it is ever found again.",
      "Now that they are strong, the turtles are being taken by boat to warmer water further south, where they will be released.",
      "The rescuers say the number of cold-stunned turtles found each year has been changing, and they want to understand why.",
    ],
    word: ["Reptile", "A cold-blooded animal with scaly skin, such as a turtle, snake or lizard."],
    think: "Why do you think scientists want to tag the turtles before releasing them?",
  },
  {
    topic: "Games and tech",
    title: "Why some games stopped saving",
    teaser: "The problem was far away from the consoles themselves",
    body: [
      "Thousands of gamers switched on their consoles one evening and found that their games would not save their progress. Some could not log in at all.",
      "At first, many players thought something was wrong with their own console or their home internet. In fact, the problem was hundreds of miles away, in a building full of the powerful computers that the games rely on.",
      "These computers are called servers. Many modern games do not just store your progress on your console. They also send it over the internet to a server, so that you can carry on playing on another device and so that the game knows which items you own.",
      "When the servers stopped working properly, the games could not check who players were or where to store their progress. To avoid losing anything, many of them simply refused to save.",
      "Engineers worked through the night to find the cause. The company later said that a change made to one part of the system during routine maintenance had caused a chain of problems in other parts.",
      "After a few hours, most players could get back to their games, and the company said that nobody's saved progress had been lost. It apologised and promised to look at how it tests changes before they go live.",
      "Some players said the problem made them realise how much their games depend on computers they never see.",
    ],
    word: ["Server", "A powerful computer that stores information and sends it to lots of other computers over a network."],
    think: "What are the good and bad sides of games that keep your progress on a server rather than on your own console?",
  },
];

// Earlier papers, for Back issues: three short stories each.
const EARLIER: Sample[][] = [
  [
    { topic: "Weather", title: "First frost of the winter", teaser: "Gardens sparkled white this morning", body: ["Many people woke up to the first frost of the winter.", "Frost forms when the ground gets colder than freezing and water in the air turns to ice.", "Forecasters say the days will warm up again later this week."], word: ["Frost", "A thin layer of ice that forms on cold surfaces."], think: "What is your favourite kind of weather?" },
    { topic: "Animals and nature", photo: "turtle", alt: "A green sea turtle swimming", title: "Turtle hospital opens a new pool", teaser: "More room for animals that need help", body: ["An animal hospital by the sea has opened a new pool for turtles.", "The pool can be kept at just the right temperature for each animal.", "Vets say it will help them look after more turtles every winter."], word: ["Temperature", "How hot or cold something is."], think: "Which animal would you most like to look after?" },
    { topic: "Science", title: "Bees can count to four", teaser: "Scientists tested them with a clever game", body: ["Scientists think bees can count, at least up to four.", "In a test, bees learned to fly to the card with the right number of shapes on it to find a sweet drink.", "The scientists want to find out how such a small brain can do it."], word: ["Test", "A way of finding out what someone or something can do."], think: "How would you test whether an animal can count?" },
  ],
  [
    { topic: "Space", photo: "rocket", alt: "A tall rocket beside its launch tower", title: "Rocket test lights up the night", teaser: "Its engines fired for ten seconds", body: ["A rocket fired its engines on the ground for ten seconds in a test.", "Tests like this check that the engines work before the rocket flies.", "The team said the test went well."], word: ["Engine", "The part of a machine that makes it move."], think: "Would you like to watch a rocket launch?" },
    { topic: "Football", photo: "match", alt: "Children playing football", title: "School wins its first league match", teaser: "The team had trained all summer", body: ["A school football team has won its first league match.", "The players trained every week over the summer holidays.", "Their coach said she was proud of how well they worked together."], word: ["League", "A group of teams that play each other during a season."], think: "What makes a good team-mate?" },
    { topic: "Weird but true", title: "Pumpkin as heavy as a small car", teaser: "It took eight people to lift it", body: ["A giant pumpkin weighing as much as a small car has won a prize at a show.", "The grower fed it water every day for months.", "After the show, the pumpkin was carved into a giant lantern."], word: ["Grower", "Someone who grows plants or vegetables."], think: "What would you grow if you had a garden?" },
  ],
];

const londonToday = londonDate(new Date());

// Wikimedia answers Node's fetch with 429 (as of November 2026) while serving curl, so the photos
// come through curl, which ships with macOS and most Linux systems.
async function download(url: string): Promise<Buffer> {
  try {
    return execFileSync("curl", ["-sSfL", "--max-time", "60", "-A", "early-edition-kids-docs/1.0", url], { maxBuffer: 50 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`could not download ${url}: ${(err as Error).message}`);
  }
}

const photos = new Map<string, Buffer>();
for (const [key, url] of Object.entries(PHOTOS)) photos.set(key, await download(url));

function row(s: Sample): StoryRow {
  const wordToKnow = { word: s.word[0], definition: s.word[1] };
  return {
    topic: s.topic,
    title: s.title,
    teaser: s.teaser,
    body_html: bodyToHtml(s.body, wordToKnow),
    word_to_know: JSON.stringify(wordToKnow),
    think_about_it: s.think,
    source_name: "Sample story",
    source_url: "https://example.com/sample",
    source_title: s.title,
    word_count: s.body.join(" ").split(/\s+/).length,
    reused_from: null,
    added_by: null,
    image: s.photo ? { ext: "jpg", alt: s.alt ?? null, url: PHOTOS[s.photo], bytes: photos.get(s.photo) } : null,
  };
}

const settings = settingsFromEnv();
const config = loadConfig(settings.configPath);
const db = new Database(dbPath(settings));
db.init();
const ctx = buildContext(settings, config, db, { writer: new StubLLM() });

EARLIER.forEach((paper, i) => storeIssue(ctx, addDays(londonToday, -(EARLIER.length - i)), paper.map(row), false));
storeIssue(ctx, londonToday, TODAY.map(row), false);
db.close();
console.log(`sample papers stored in ${settings.dataDir} for ${addDays(londonToday, -EARLIER.length)} to ${londonToday}`);
