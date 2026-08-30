import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';

import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';

import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  increment
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

import {
  firebaseConfig,
  ADMIN_EMAIL
} from './firebase-config.js';


const $ = id => document.getElementById(id);

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);

const GAME = 'current';

const gameRef = doc(
  db,
  'games',
  GAME
);


// ======================================================
// GAME STATE
// ======================================================

let game = {
  teamCount: 4,
  playersPerTeam: 5,

  status: 'registration',

  timerDuration: 600,
  timerRemaining: 600,
  timerRunning: false,
  timerEndAt: null,

  activeHomeTeam: 1,
  activeAwayTeam: 2,

  scores: {
    1: 0,
    2: 0,
    3: 0,
    4: 0
  }
};


let players = [];

let events = [];

let timerInterval = null;

let unsubscribeGame = null;

let unsubscribePlayers = null;

let unsubscribeEvents = null;


// ======================================================
// HELPERS
// ======================================================

function normalizeEmail(value) {
  return String(
    value || ''
  )
    .trim()
    .toLowerCase();
}


function teamLabel(team) {
  return `קבוצה ${team}`;
}


function currentScore(team) {
  return Number(
    game.scores?.[String(team)] ??
    game.scores?.[team] ??
    0
  );
}


function clamp(
  value,
  min,
  max
) {
  value =
    Number(value);

  return Number.isFinite(value)
    ? Math.min(
        max,
        Math.max(
          min,
          value
        )
      )
    : min;
}


function formatTimer(total) {

  total =
    Math.max(
      0,
      Math.floor(
        Number(total) || 0
      )
    );


  const minutes =
    String(
      Math.floor(
        total / 60
      )
    ).padStart(
      2,
      '0'
    );


  const seconds =
    String(
      total % 60
    ).padStart(
      2,
      '0'
    );


  return `${minutes}:${seconds}`;
}


function timerSecondsLeft() {

  if (
    game.timerRunning &&
    game.timerEndAt
  ) {

    return Math.max(
      0,
      Math.ceil(
        (
          Number(
            game.timerEndAt
          ) -
          Date.now()
        ) /
        1000
      )
    );
  }


  return Math.max(
    0,
    Number(
      game.timerRemaining ??
      game.timerDuration ??
      0
    )
  );
}


function shuffled(array) {

  const copy =
    [...array];


  for (
    let i =
      copy.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (
          i + 1
        )
      );


    [
      copy[i],
      copy[j]
    ] =
    [
      copy[j],
      copy[i]
    ];
  }


  return copy;
}


function escapeHtml(value) {

  return String(
    value ??
    ''
  ).replace(
    /[&<>'"]/g,
    character =>
      ({
        '&':
          '&amp;',

        '<':
          '&lt;',

        '>':
          '&gt;',

        "'":
          '&#39;',

        '"':
          '&quot;'
      })[
        character
      ]
  );
}


// ======================================================
// FIRESTORE LISTENERS
// ======================================================

function stopAdminListeners() {

  if (
    unsubscribeGame
  ) {

    unsubscribeGame();
  }


  if (
    unsubscribePlayers
  ) {

    unsubscribePlayers();
  }


  if (
    unsubscribeEvents
  ) {

    unsubscribeEvents();
  }


  unsubscribeGame =
    null;

  unsubscribePlayers =
    null;

  unsubscribeEvents =
    null;
}


function startAdminListeners() {

  stopAdminListeners();


  // GAME

  unsubscribeGame =
    onSnapshot(

      gameRef,

      async snapshot => {

        if (
          snapshot.exists()
        ) {

          game = {
            ...game,
            ...snapshot.data()
          };

        } else {

          await setDoc(
            gameRef,
            game
          );
        }


        syncSettings();

        renderAll();
      },

      error => {

        console.error(
          'Game listener error:',
          error
        );


        if (
          $('settingsMsg')
        ) {

          $('settingsMsg').textContent =
            'אין הרשאה לקרוא את נתוני המשחק.';
        }
      }
    );


  // PLAYERS

  unsubscribePlayers =
    onSnapshot(

      collection(
        db,
        'games',
        GAME,
        'players'
      ),

      snapshot => {

        players =
          snapshot.docs.map(
            item => ({
              id:
                item.id,

              ...item.data()
            })
          );


        renderAll();
      },

      error => {

        console.error(
          'Players listener error:',
          error
        );
      }
    );


  // EVENTS

  unsubscribeEvents =
    onSnapshot(

      collection(
        db,
        'games',
        GAME,
        'events'
      ),

      snapshot => {

        events =
          snapshot.docs
            .map(
              item => ({
                id:
                  item.id,

                ...item.data()
              })
            )
            .sort(
              (
                a,
                b
              ) =>
                Number(
                  a.createdAtMs ||
                  0
                ) -
                Number(
                  b.createdAtMs ||
                  0
                )
            );


        renderGoalEvents();
      },

      error => {

        console.error(
          'Events listener error:',
          error
        );
      }
    );
}


// ======================================================
// ADMIN LOGIN
// ======================================================

$('loginBtn')
  .addEventListener(
    'click',
    async () => {

      const email =
        $('email').value.trim();


      const password =
        $('password').value;


      if (
        !email
      ) {

        $('loginMsg').textContent =
          'יש להזין כתובת אימייל.';

        return;
      }


      if (
        !password
      ) {

        $('loginMsg').textContent =
          'יש להזין סיסמה.';

        return;
      }


      $('loginMsg').textContent =
        'מתחבר...';


      $('loginBtn').disabled =
        true;


      try {

        const result =
          await signInWithEmailAndPassword(
            auth,
            email,
            password
          );


        const loggedEmail =
          normalizeEmail(
            result.user.email
          );


        const allowedEmail =
          normalizeEmail(
            ADMIN_EMAIL
          );


        if (
          loggedEmail !==
          allowedEmail
        ) {

          await signOut(
            auth
          );


          $('loginMsg').textContent =
            'החשבון הזה אינו מורשה כמנהל.';


          return;
        }


        $('loginMsg').textContent =
          '';

      } catch (
        error
      ) {

        console.error(
          'Admin login error:',
          error
        );


        switch (
          error.code
        ) {

          case 'auth/invalid-credential':

            $('loginMsg').textContent =
              'האימייל או הסיסמה שגויים.';

            break;


          case 'auth/user-not-found':

            $('loginMsg').textContent =
              'לא נמצא משתמש עם האימייל הזה.';

            break;


          case 'auth/wrong-password':

            $('loginMsg').textContent =
              'הסיסמה שגויה.';

            break;


          case 'auth/operation-not-allowed':

            $('loginMsg').textContent =
              'Email/Password לא מופעל ב-Firebase Authentication.';

            break;


          case 'auth/too-many-requests':

            $('loginMsg').textContent =
              'יותר מדי ניסיונות התחברות. נסה שוב מאוחר יותר.';

            break;


          default:

            $('loginMsg').textContent =
              `שגיאת התחברות: ${
                error.code ||
                error.message
              }`;
        }

      } finally {

        $('loginBtn').disabled =
          false;
      }
    }
  );


// ENTER ON PASSWORD

$('password')
  .addEventListener(
    'keydown',
    event => {

      if (
        event.key ===
        'Enter'
      ) {

        $('loginBtn').click();
      }
    }
  );


// ======================================================
// LOGOUT
// ======================================================

$('logoutBtn')
  .addEventListener(
    'click',
    async () => {

      stopAdminListeners();

      await signOut(
        auth
      );
    }
  );


// ======================================================
// AUTH STATE
// ======================================================

onAuthStateChanged(
  auth,
  async user => {

    const isAdmin =
      !!user?.email &&
      normalizeEmail(
        user.email
      ) ===
      normalizeEmail(
        ADMIN_EMAIL
      );


    $('loginCard')
      .classList
      .toggle(
        'hidden',
        isAdmin
      );


    $('adminApp')
      .classList
      .toggle(
        'hidden',
        !isAdmin
      );


    $('logoutBtn')
      .classList
      .toggle(
        'hidden',
        !isAdmin
      );


    if (
      isAdmin
    ) {

      $('loginMsg').textContent =
        '';


      startAdminListeners();


      return;
    }


    stopAdminListeners();


    if (
      user &&
      !user.isAnonymous
    ) {

      $('loginMsg').textContent =
        'החשבון הזה אינו מורשה כמנהל.';


      await signOut(
        auth
      );
    }
  }
);


// ======================================================
// SETTINGS
// ======================================================

function syncSettings() {

  $('teamCount').value =
    String(
      game.teamCount ||
      4
    );


  $('playersPerTeam').value =
    String(
      game.playersPerTeam ||
      5
    );


  $('gameStatus').value =
    game.status ||
    'registration';


  syncTimerInputs();

  syncTeamSelectors();
}


function syncTimerInputs() {

  const activeElement = document.activeElement;

  // אם אתה כרגע עורך את הדקות או השניות,
  // לא מחזירים את הערך הישן מ-Firebase
  if (
    activeElement === $('timerMinutes') ||
    activeElement === $('timerSeconds')
  ) {
    return;
  }

  const total = Math.max(
    0,
    Number(
      game.timerRemaining ??
      game.timerDuration ??
      600
    )
  );

  $('timerMinutes').value =
    Math.floor(total / 60);

  $('timerSeconds').value =
    total % 60;
}

function syncTeamSelectors() {

  const numberOfTeams =
    Math.max(
      1,
      Number(
        game.teamCount ||
        4
      )
    );


  const options =
    Array
      .from(
        {
          length:
            numberOfTeams
        },
        (
          _,
          index
        ) =>
          `
            <option value="${index + 1}">
              ${teamLabel(index + 1)}
            </option>
          `
      )
      .join('');


  [
    'homeTeam',
    'awayTeam'
  ]
    .forEach(
      id => {

        const select =
          $(id);


        const oldValue =
          select.value;


        select.innerHTML =
          options;


        if (
          oldValue &&
          Number(
            oldValue
          ) <=
          numberOfTeams
        ) {

          select.value =
            oldValue;
        }
      }
    );


  const home =
    Math.min(
      Number(
        game.activeHomeTeam ||
        1
      ),
      numberOfTeams
    );


  let away =
    Math.min(
      Number(
        game.activeAwayTeam ||
        2
      ),
      numberOfTeams
    );


  if (
    away ===
    home &&
    numberOfTeams > 1
  ) {

    away =
      home === 1
        ? 2
        : 1;
  }


  $('homeTeam').value =
    String(
      home
    );


  $('awayTeam').value =
    String(
      away
    );


  renderGoalTeamOptions();
}


// ======================================================
// RENDER ALL
// ======================================================

function renderAll() {

  renderPlayers();

  renderTeams();

  renderStats();

  renderTimer();

  renderScoreboard();

  renderGoalEvents();
}


// ======================================================
// PLAYERS
// ======================================================

function renderPlayers() {

  const target =
    Number(
      game.teamCount ||
      4
    ) *
    Number(
      game.playersPerTeam ||
      5
    );


  $('adminCount').textContent =
    `${players.length}/${target} שחקנים`;


  $('adminPlayers').innerHTML =
    players
      .map(
        player =>
          `
            <div class="player-row">

              <span>

                <b>
                  ${escapeHtml(
                    player.name
                  )}
                </b>

                <span class="pill">

                  ${
                    player.team
                      ? teamLabel(
                          player.team
                        )
                      : 'ללא קבוצה'
                  }

                </span>

              </span>

              <button
                class="danger small remove"
                data-id="${player.id}"
              >
                הסר
              </button>

            </div>
          `
      )
      .join('') ||
    '<span class="muted">אין שחקנים.</span>';


  document
    .querySelectorAll(
      '.remove'
    )
    .forEach(
      button => {

        button.onclick =
          () =>
            deleteDoc(
              doc(
                db,
                'games',
                GAME,
                'players',
                button.dataset.id
              )
            );
      }
    );
}


// ======================================================
// TEAMS
// ======================================================

function renderTeams() {

  const numberOfTeams =
    Number(
      game.teamCount ||
      4
    );


  $('adminTeams').innerHTML =
    Array
      .from(
        {
          length:
            numberOfTeams
        },
        (
          _,
          index
        ) => {

          const team =
            index + 1;


          const members =
            players.filter(
              player =>
                Number(
                  player.team
                ) ===
                team
            );


          return `
            <div class="team">

              <h3>
                ${teamLabel(team)}
              </h3>

              ${
                members
                  .map(
                    player =>
                      `
                        <div class="member">

                          ${escapeHtml(
                            player.name
                          )}

                          <select
                            class="select-inline move"
                            data-id="${player.id}"
                          >

                            ${
                              Array
                                .from(
                                  {
                                    length:
                                      numberOfTeams
                                  },
                                  (
                                    _,
                                    teamIndex
                                  ) =>
                                    `
                                      <option
                                        value="${teamIndex + 1}"
                                        ${
                                          teamIndex + 1 ===
                                          team
                                            ? 'selected'
                                            : ''
                                        }
                                      >
                                        ${teamLabel(
                                          teamIndex + 1
                                        )}
                                      </option>
                                    `
                                )
                                .join('')
                            }

                          </select>

                        </div>
                      `
                  )
                  .join('') ||
                '<div class="member muted">ריקה</div>'
              }

            </div>
          `;
        }
      )
      .join('');


  document
    .querySelectorAll(
      '.move'
    )
    .forEach(
      select => {

        select.onchange =
          () =>
            updateDoc(
              doc(
                db,
                'games',
                GAME,
                'players',
                select.dataset.id
              ),
              {
                team:
                  Number(
                    select.value
                  )
              }
            );
      }
    );
}


// ======================================================
// STATS
// ======================================================

function renderStats() {

  $('statsRows').innerHTML =
    players
      .map(
        player =>
          `
            <tr>

              <td>
                ${escapeHtml(
                  player.name
                )}
              </td>

              <td>
                ${
                  Number(
                    player.goals ||
                    0
                  )
                }
              </td>

              <td>
                ${
                  Number(
                    player.assists ||
                    0
                  )
                }
              </td>

              <td>

                <input
                  type="checkbox"
                  data-id="${player.id}"
                  class="sm"
                >

              </td>

              <td>

                <input
                  type="checkbox"
                  data-id="${player.id}"
                  class="sw"
                >

              </td>

            </tr>
          `
      )
      .join('');
}


// ======================================================
// TIMER
// ======================================================

function renderTimer() {

  if (
    !$(
      'timerDisplay'
    )
  ) {

    return;
  }


  const left =
    timerSecondsLeft();


  $('timerDisplay').textContent =
    formatTimer(
      left
    );


  $('timerDisplay')
    .classList
    .toggle(
      'timer-running',
      !!game.timerRunning &&
      left > 0
    );


  $('timerPauseBtn').disabled =
    !game.timerRunning;


  if (
    game.timerRunning &&
    left <= 0
  ) {

    finishTimer();
  }
}


function startTimerTicker() {

  if (
    timerInterval
  ) {

    clearInterval(
      timerInterval
    );
  }


  timerInterval =
    setInterval(
      renderTimer,
      250
    );
}


async function finishTimer() {

  if (
    !game.timerRunning
  ) {

    return;
  }


  game.timerRunning =
    false;


  game.timerRemaining =
    0;


  game.timerEndAt =
    null;


  renderTimer();


  try {

    await updateDoc(
      gameRef,
      {
        timerRunning:
          false,

        timerRemaining:
          0,

        timerEndAt:
          null
      }
    );

  } catch (
    error
  ) {

    console.error(
      'Timer finish error:',
      error
    );
  }


  $('timerMsg').textContent =
    'הזמן הסתיים ⏱️';
}


// START TIMER

// START TIMER

$('timerStartBtn').onclick = async () => {

  const minutes =
    Number(
      $('timerMinutes').value
    );

  const seconds =
    Number(
      $('timerSeconds').value
    );

  const enteredTotal =
    (Number.isFinite(minutes) ? minutes : 0) * 60 +
    (Number.isFinite(seconds) ? seconds : 0);

  let remaining;

  // אם השעון לא רץ כרגע,
  // הזמן שהקלדת הוא הזמן שממנו מתחילים
  if (
    !game.timerRunning &&
    enteredTotal > 0
  ) {
    remaining =
      enteredTotal;
  } else {
    remaining =
      timerSecondsLeft();
  }

  if (
    remaining <= 0
  ) {
    $('timerMsg').textContent =
      'יש להגדיר זמן גדול מ־0.';
    return;
  }

  const endAt =
    Date.now() +
    remaining * 1000;

  // עדכון מקומי מיד
  game.timerDuration =
    remaining;

  game.timerRemaining =
    remaining;

  game.timerRunning =
    true;

  game.timerEndAt =
    endAt;

  renderTimer();

  // שמירה ב-Firebase
  await setDoc(
    gameRef,
    {
      timerDuration:
        remaining,

      timerRemaining:
        remaining,

      timerRunning:
        true,

      timerEndAt:
        endAt
    },
    {
      merge:
        true
    }
  );

  $('timerMsg').textContent =
    `השעון הופעל על ${formatTimer(remaining)}.`;
};

// PAUSE TIMER

$('timerPauseBtn').onclick =
  async () => {

    if (
      !game.timerRunning
    ) {

      return;
    }


    const remaining =
      timerSecondsLeft();


    await updateDoc(
      gameRef,
      {
        timerRunning:
          false,

        timerRemaining:
          remaining,

        timerEndAt:
          null
      }
    );


    $('timerMsg').textContent =
      'השעון נעצר.';
  };


// RESET TIMER

// RESET / APPLY TIMER

// RESET / APPLY TIMER

$('timerResetBtn').onclick = async () => {

  const minutes =
    Number(
      $('timerMinutes').value
    );

  const seconds =
    Number(
      $('timerSeconds').value
    );

  const total =
    (Number.isFinite(minutes) ? minutes : 0) * 60 +
    (Number.isFinite(seconds) ? seconds : 0);

  if (
    total <= 0
  ) {
    $('timerMsg').textContent =
      'יש להגדיר זמן גדול מ־0.';
    return;
  }

  // עדכון מקומי
  game.timerDuration =
    total;

  game.timerRemaining =
    total;

  game.timerRunning =
    false;

  game.timerEndAt =
    null;

  $('timerDisplay').textContent =
    formatTimer(total);

  // שמירה ב-Firebase
  await setDoc(
    gameRef,
    {
      timerDuration:
        total,

      timerRemaining:
        total,

      timerRunning:
        false,

      timerEndAt:
        null
    },
    {
      merge:
        true
    }
  );

  $('timerMinutes').value =
    Math.floor(
      total / 60
    );

  $('timerSeconds').value =
    total % 60;

  $('timerDisplay').textContent =
    formatTimer(total);

  $('timerMsg').textContent =
    `הזמן הוגדר ל־${formatTimer(total)} ✅`;
};

// ======================================================
// SCOREBOARD
// ======================================================

function renderScoreboard() {

  const home =
    Number(
      game.activeHomeTeam ||
      1
    );


  const away =
    Number(
      game.activeAwayTeam ||
      2
    );


  $('homeTeamLabel').textContent =
    teamLabel(
      home
    );


  $('awayTeamLabel').textContent =
    teamLabel(
      away
    );


  $('homeScore').textContent =
    currentScore(
      home
    );


  $('awayScore').textContent =
    currentScore(
      away
    );


  renderGoalTeamOptions();
}


// ======================================================
// GOAL TEAM OPTIONS
// ======================================================

function renderGoalTeamOptions() {

  if (
    !$(
      'goalTeam'
    )
  ) {

    return;
  }


  const home =
    Number(
      game.activeHomeTeam ||
      1
    );


  const away =
    Number(
      game.activeAwayTeam ||
      2
    );


  const oldValue =
    Number(
      $('goalTeam').value ||
      home
    );


  $('goalTeam').innerHTML =
    `
      <option value="${home}">
        ${teamLabel(home)}
      </option>

      <option value="${away}">
        ${teamLabel(away)}
      </option>
    `;


  $('goalTeam').value =
    String(
      oldValue ===
      away
        ? away
        : home
    );


  renderScorerOptions();
}


// ======================================================
// SCORER / ASSISTER
// ======================================================

function renderScorerOptions() {

  const team =
    Number(
      $('goalTeam')?.value ||
      game.activeHomeTeam ||
      1
    );


  const members =
    players.filter(
      player =>
        Number(
          player.team
        ) ===
        team
    );


  $('scorer').innerHTML =
    '<option value="">בחר כובש</option>' +
    members
      .map(
        player =>
          `
            <option value="${player.id}">
              ${escapeHtml(
                player.name
              )}
            </option>
          `
      )
      .join('');


  $('assister').innerHTML =
    '<option value="">ללא בישול</option>' +
    members
      .map(
        player =>
          `
            <option value="${player.id}">
              ${escapeHtml(
                player.name
              )}
            </option>
          `
      )
      .join('');
}


// ======================================================
// GOAL EVENTS
// ======================================================

function renderGoalEvents() {

  if (
    !$(
      'goalEvents'
    )
  ) {

    return;
  }


  const goalEvents =
    events.filter(
      event =>
        event.type ===
        'goal'
    );


  if (
    !goalEvents.length
  ) {

    $('goalEvents').innerHTML =
      '<span class="muted">עדיין אין אירועי גול.</span>';

    return;
  }


  $('goalEvents').innerHTML =
    [
      ...goalEvents
    ]
      .reverse()
      .map(
        event =>
          `
            <div class="event-row">

              <div>

                <b>
                  ⚽
                  ${escapeHtml(
                    event.scorerName ||
                    'לא ידוע'
                  )}
                </b>

                ·
                ${teamLabel(
                  event.team
                )}

                ${
                  event.assisterName
                    ? ` · בישול: ${escapeHtml(
                        event.assisterName
                      )}`
                    : ''
                }

                <div class="muted small">

                  ${escapeHtml(
                    event.timerText ||
                    ''
                  )}

                </div>

              </div>

              <button
                class="danger small undo-goal"
                data-id="${event.id}"
              >
                בטל גול
              </button>

            </div>
          `
      )
      .join('');


  document
    .querySelectorAll(
      '.undo-goal'
    )
    .forEach(
      button => {

        button.onclick =
          () =>
            undoGoal(
              button.dataset.id
            );
      }
    );
}


// ======================================================
// SHUFFLE TEAMS
// ======================================================

async function shuffle() {

  const numberOfTeams =
    Number(
      game.teamCount ||
      4
    );


  const playerList =
    shuffled(
      players
    );


  const batch =
    writeBatch(
      db
    );


  playerList.forEach(
    (
      player,
      index
    ) => {

      batch.update(
        doc(
          db,
          'games',
          GAME,
          'players',
          player.id
        ),
        {
          team:
            (
              index %
              numberOfTeams
            ) +
            1
        }
      );
    }
  );


  await batch.commit();


  $('settingsMsg').textContent =
    'הקבוצות הוגרלו.';
}


// ======================================================
// ADD GOAL
// ======================================================

async function addGoal() {

  const team =
    Number(
      $('goalTeam').value
    );


  const scorerId =
    $('scorer').value;


  const assisterId =
    $('assister').value;


  const home =
    Number(
      game.activeHomeTeam ||
      1
    );


  const away =
    Number(
      game.activeAwayTeam ||
      2
    );


  if (
    ![
      home,
      away
    ].includes(
      team
    )
  ) {

    $('scoreMsg').textContent =
      'יש לבחור קבוצה שמשחקת כרגע.';

    return;
  }


  const scorer =
    players.find(
      player =>
        player.id ===
        scorerId
    );


  const assister =
    assisterId
      ? players.find(
          player =>
            player.id ===
            assisterId
        )
      : null;


  if (
    !scorer ||
    Number(
      scorer.team
    ) !==
    team
  ) {

    $('scoreMsg').textContent =
      'יש לבחור כובש מהקבוצה הנכונה.';

    return;
  }


  if (
    assister &&
    Number(
      assister.team
    ) !==
    team
  ) {

    $('scoreMsg').textContent =
      'המבשל חייב להיות מאותה קבוצה.';

    return;
  }


  if (
    assisterId &&
    assisterId ===
    scorerId
  ) {

    $('scoreMsg').textContent =
      'כובש לא יכול לבשל לעצמו.';

    return;
  }


  const eventRef =
    doc(
      collection(
        db,
        'games',
        GAME,
        'events'
      )
    );


  const batch =
    writeBatch(
      db
    );


  batch.update(
    gameRef,
    {
      [`scores.${team}`]:
        increment(
          1
        )
    }
  );


  batch.update(
    doc(
      db,
      'games',
      GAME,
      'players',
      scorerId
    ),
    {
      goals:
        increment(
          1
        )
    }
  );


  if (
    assister
  ) {

    batch.update(
      doc(
        db,
        'games',
        GAME,
        'players',
        assister.id
      ),
      {
        assists:
          increment(
            1
          )
      }
    );
  }


  const remaining =
    timerSecondsLeft();


  batch.set(
    eventRef,
    {
      type:
        'goal',

      team,

      scorerId,

      scorerName:
        scorer.name,

      assisterId:
        assister?.id ||
        null,

      assisterName:
        assister?.name ||
        null,

      timerRemaining:
        remaining,

      timerText:
        formatTimer(
          remaining
        ),

      createdAt:
        serverTimestamp(),

      createdAtMs:
        Date.now()
    }
  );


  await batch.commit();


  $('scoreMsg').textContent =
    `גול ל${teamLabel(team)} — ${scorer.name} ⚽`;


  $('scorer').value =
    '';


  $('assister').value =
    '';
}


// ======================================================
// UNDO GOAL
// ======================================================

async function undoGoal(
  eventId
) {

  const event =
    events.find(
      item =>
        item.id ===
        eventId &&
        item.type ===
        'goal'
    );


  if (
    !event
  ) {

    return;
  }


  const score =
    currentScore(
      event.team
    );


  const scorer =
    players.find(
      player =>
        player.id ===
        event.scorerId
    );


  const assister =
    event.assisterId
      ? players.find(
          player =>
            player.id ===
            event.assisterId
        )
      : null;


  const batch =
    writeBatch(
      db
    );


  batch.update(
    gameRef,
    {
      [`scores.${event.team}`]:
        Math.max(
          0,
          score -
          1
        )
    }
  );


  if (
    scorer
  ) {

    batch.update(
      doc(
        db,
        'games',
        GAME,
        'players',
        scorer.id
      ),
      {
        goals:
          Math.max(
            0,
            Number(
              scorer.goals ||
              0
            ) -
            1
          )
      }
    );
  }


  if (
    assister
  ) {

    batch.update(
      doc(
        db,
        'games',
        GAME,
        'players',
        assister.id
      ),
      {
        assists:
          Math.max(
            0,
            Number(
              assister.assists ||
              0
            ) -
            1
          )
      }
    );
  }


  batch.delete(
    doc(
      db,
      'games',
      GAME,
      'events',
      eventId
    )
  );


  await batch.commit();


  $('scoreMsg').textContent =
    'הגול בוטל והסטטיסטיקה עודכנה.';
}


// ======================================================
// RESET SCORE
// ======================================================

async function resetScoreAndEvents() {

  if (
    !confirm(
      'לאפס את התוצאה ולמחוק את כל אירועי הגולים של המשחק?'
    )
  ) {

    return;
  }


  const goalEvents =
    events.filter(
      event =>
        event.type ===
        'goal'
    );


  const goalByPlayer =
    {};


  const assistByPlayer =
    {};


  goalEvents.forEach(
    event => {

      if (
        event.scorerId
      ) {

        goalByPlayer[
          event.scorerId
        ] =
          (
            goalByPlayer[
              event.scorerId
            ] ||
            0
          ) +
          1;
      }


      if (
        event.assisterId
      ) {

        assistByPlayer[
          event.assisterId
        ] =
          (
            assistByPlayer[
              event.assisterId
            ] ||
            0
          ) +
          1;
      }
    }
  );


  const batch =
    writeBatch(
      db
    );


  const scores =
    {};


  for (
    let i = 1;
    i <=
    Number(
      game.teamCount ||
      4
    );
    i++
  ) {

    scores[i] =
      0;
  }


  batch.update(
    gameRef,
    {
      scores
    }
  );


  players.forEach(
    player => {

      const goals =
        Math.max(
          0,
          Number(
            player.goals ||
            0
          ) -
          Number(
            goalByPlayer[
              player.id
            ] ||
            0
          )
        );


      const assists =
        Math.max(
          0,
          Number(
            player.assists ||
            0
          ) -
          Number(
            assistByPlayer[
              player.id
            ] ||
            0
          )
        );


      batch.update(
        doc(
          db,
          'games',
          GAME,
          'players',
          player.id
        ),
        {
          goals,
          assists
        }
      );
    }
  );


  goalEvents.forEach(
    event => {

      batch.delete(
        doc(
          db,
          'games',
          GAME,
          'events',
          event.id
        )
      );
    }
  );


  await batch.commit();


  $('scoreMsg').textContent =
    'התוצאה ואירועי הגולים אופסו.';
}


// ======================================================
// ACTIVE TEAMS
// ======================================================

$('homeTeam')
  .addEventListener(
    'change',
    () => {

      if (
        $('awayTeam').value ===
        $('homeTeam').value
      ) {

        const numberOfTeams =
          Number(
            game.teamCount ||
            4
          );


        $('awayTeam').value =
          String(
            Number(
              $('homeTeam').value
            ) ===
            1 &&
            numberOfTeams > 1
              ? 2
              : 1
          );
      }
    }
  );


$('awayTeam')
  .addEventListener(
    'change',
    () => {

      if (
        $('awayTeam').value ===
        $('homeTeam').value
      ) {

        $('scoreMsg').textContent =
          'יש לבחור שתי קבוצות שונות.';
      }
    }
  );


$('goalTeam')
  .addEventListener(
    'change',
    renderScorerOptions
  );


$('addGoalBtn').onclick =
  addGoal;


$('resetScoreBtn').onclick =
  resetScoreAndEvents;


// ======================================================
// SAVE MATCHUP
// ======================================================

$('saveMatchupBtn').onclick =
  async () => {

    const home =
      Number(
        $('homeTeam').value
      );


    const away =
      Number(
        $('awayTeam').value
      );


    if (
      home ===
      away
    ) {

      $('scoreMsg').textContent =
        'יש לבחור שתי קבוצות שונות.';

      return;
    }


    await setDoc(
      gameRef,
      {
        activeHomeTeam:
          home,

        activeAwayTeam:
          away
      },
      {
        merge:
          true
      }
    );


    $('scoreMsg').textContent =
      `${teamLabel(home)} נגד ${teamLabel(away)} נשמר.`;
  };


// ======================================================
// SHUFFLE / REVEAL
// ======================================================

$('shuffleBtn').onclick =
  shuffle;


$('revealBtn').onclick =
  async () => {

    if (
      players.some(
        player =>
          !player.team
      )
    ) {

      await shuffle();
    }


    await updateDoc(
      gameRef,
      {
        status:
          'revealed'
      }
    );


    $('settingsMsg').textContent =
      'הקבוצות נחשפו לכל השחקנים ✅';
  };


// ======================================================
// SAVE SETTINGS
// ======================================================

$('saveSettings').onclick =
  async () => {

    const numberOfTeams =
      Number(
        $('teamCount').value
      );


    const scores =
      {
        ...(
          game.scores ||
          {}
        )
      };


    for (
      let i = 1;
      i <=
      numberOfTeams;
      i++
    ) {

      if (
        scores[i] ==
        null
      ) {

        scores[i] =
          0;
      }
    }


    await setDoc(
      gameRef,
      {
        teamCount:
          numberOfTeams,

        playersPerTeam:
          Number(
            $('playersPerTeam').value
          ),

        status:
          $('gameStatus').value,

        scores
      },
      {
        merge:
          true
      }
    );


    $('settingsMsg').textContent =
      'ההגדרות נשמרו.';
  };


// ======================================================
// RESET COMPLETE GAME
// ======================================================

$('resetBtn').onclick =
  async () => {

    if (
      !confirm(
        'לאפס את המשחק ולמחוק את כל הנרשמים והאירועים?'
      )
    ) {

      return;
    }


    const playerSnapshot =
      await getDocs(
        collection(
          db,
          'games',
          GAME,
          'players'
        )
      );


    const eventSnapshot =
      await getDocs(
        collection(
          db,
          'games',
          GAME,
          'events'
        )
      );


    const batch =
      writeBatch(
        db
      );


    playerSnapshot.forEach(
      documentSnapshot => {

        batch.delete(
          documentSnapshot.ref
        );
      }
    );


    eventSnapshot.forEach(
      documentSnapshot => {

        batch.delete(
          documentSnapshot.ref
        );
      }
    );


    batch.set(
      gameRef,
      {
        teamCount:
          4,

        playersPerTeam:
          5,

        status:
          'registration',

        timerDuration:
          600,

        timerRemaining:
          600,

        timerRunning:
          false,

        timerEndAt:
          null,

        activeHomeTeam:
          1,

        activeAwayTeam:
          2,

        scores: {
          1: 0,
          2: 0,
          3: 0,
          4: 0
        }
      }
    );


    await batch.commit();


    $('settingsMsg').textContent =
      'המשחק אופס.';
  };


// ======================================================
// SAVE MATCH STATS
// ======================================================

$('saveStats').onclick =
  async () => {

    const batch =
      writeBatch(
        db
      );


    for (
      const player of
      players
    ) {

      const mvp =
        document.querySelector(
          `.sm[data-id="${player.id}"]`
        )?.checked
          ? 1
          : 0;


      const win =
        document.querySelector(
          `.sw[data-id="${player.id}"]`
        )?.checked
          ? 1
          : 0;


      batch.update(
        doc(
          db,
          'games',
          GAME,
          'players',
          player.id
        ),
        {
          mvp:
            Number(
              player.mvp ||
              0
            ) +
            mvp,

          wins:
            Number(
              player.wins ||
              0
            ) +
            win,

          games:
            Number(
              player.games ||
              0
            ) +
            1
        }
      );
    }


    batch.update(
      gameRef,
      {
        status:
          'finished',

        timerRunning:
          false,

        timerEndAt:
          null,

        timerRemaining:
          timerSecondsLeft()
      }
    );


    await batch.commit();


    $('statsMsg').textContent =
      'המשחק נשמר והסטטיסטיקה עודכנה ✅';
  };


// ======================================================
// START TIMER
// ======================================================

startTimerTicker();
