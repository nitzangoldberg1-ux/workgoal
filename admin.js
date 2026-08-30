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


// ======================================================
// INITIALIZATION
// ======================================================

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
// DEFAULT GAME STATE
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
  return String(value || '')
    .trim()
    .toLowerCase();
}


function teamLabel(team) {
  return `קבוצה ${team}`;
}


function clamp(value, min, max) {
  value = Number(value);

  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(
    max,
    Math.max(
      min,
      value
    )
  );
}


function currentScore(team) {
  return Number(
    game.scores?.[String(team)] ??
    game.scores?.[team] ??
    0
  );
}


function formatTimer(totalSeconds) {

  const total =
    Math.max(
      0,
      Math.floor(
        Number(totalSeconds) || 0
      )
    );

  const minutes =
    String(
      Math.floor(total / 60)
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
          Number(game.timerEndAt) -
          Date.now()
        ) / 1000
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

  const copy = [...array];

  for (
    let i = copy.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (i + 1)
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
    value ?? ''
  ).replace(
    /[&<>'"]/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      })[character]
  );
}


// ======================================================
// FIRESTORE LISTENERS
// ======================================================

function stopAdminListeners() {

  if (unsubscribeGame) {
    unsubscribeGame();
  }

  if (unsubscribePlayers) {
    unsubscribePlayers();
  }

  if (unsubscribeEvents) {
    unsubscribeEvents();
  }

  unsubscribeGame = null;
  unsubscribePlayers = null;
  unsubscribeEvents = null;
}


function startAdminListeners() {

  stopAdminListeners();


  // GAME LISTENER

  unsubscribeGame = onSnapshot(

    gameRef,

    async snapshot => {

      if (snapshot.exists()) {

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

      if ($('settingsMsg')) {

        $('settingsMsg').textContent =
          'אין הרשאה לקרוא את נתוני המשחק.';
      }
    }
  );


  // PLAYERS LISTENER

  unsubscribePlayers = onSnapshot(

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
            id: item.id,
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


  // EVENTS LISTENER

  unsubscribeEvents = onSnapshot(

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
              id: item.id,
              ...item.data()
            })
          )
          .sort(
            (a, b) =>
              Number(a.createdAtMs || 0) -
              Number(b.createdAtMs || 0)
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

async function loginAdmin() {

  const email =
    $('email').value.trim();

  const password =
    $('password').value;


  if (!email) {

    $('loginMsg').textContent =
      'יש להזין כתובת אימייל.';

    return;
  }


  if (!password) {

    $('loginMsg').textContent =
      'יש להזין סיסמה.';

    return;
  }


  $('loginMsg').textContent =
    'מתחבר...';


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


    console.log(
      'Logged admin:',
      loggedEmail
    );


    if (
      loggedEmail !==
      allowedEmail
    ) {

      await signOut(auth);

      $('loginMsg').textContent =
        'החשבון הזה אינו מורשה כמנהל.';

      return;
    }


    $('loginMsg').textContent =
      '';

  } catch (error) {

    console.error(
      'Admin login error:',
      error
    );


    switch (error.code) {

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
          'Email/Password לא מופעל ב-Firebase.';

        break;


      case 'auth/too-many-requests':

        $('loginMsg').textContent =
          'יותר מדי ניסיונות התחברות. נסה שוב בעוד מספר דקות.';

        break;


      default:

        $('loginMsg').textContent =
          `שגיאת התחברות: ${
            error.code ||
            error.message
          }`;
    }
  }
}


$('loginBtn').addEventListener(
  'click',
  loginAdmin
);


$('password').addEventListener(
  'keydown',
  event => {

    if (
      event.key ===
      'Enter'
    ) {

      loginAdmin();
    }
  }
);


// ======================================================
// LOGOUT
// ======================================================

$('logoutBtn').addEventListener(
  'click',
  async () => {

    stopAdminListeners();

    await signOut(auth);
  }
);


// ======================================================
// AUTH STATE
// ======================================================

onAuthStateChanged(
  auth,
  async user => {

    const loggedEmail =
      normalizeEmail(
        user?.email
      );


    const allowedEmail =
      normalizeEmail(
        ADMIN_EMAIL
      );


    const isAdmin =
      !!user &&
      !!loggedEmail &&
      loggedEmail ===
        allowedEmail;


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


    if (isAdmin) {

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

      await signOut(auth);
    }
  }
);


// ======================================================
// SETTINGS
// ======================================================

function syncSettings() {

  $('teamCount').value =
    String(
      game.teamCount || 4
    );


  $('playersPerTeam').value =
    String(
      game.playersPerTeam || 5
    );


  $('gameStatus').value =
    game.status ||
    'registration';


  syncTimerInputs();
  syncTeamSelectors();
}


function syncTimerInputs() {

  const total =
    Math.max(
      0,
      Number(
        game.timerDuration ??
        600
      )
    );


  $('timerMinutes').value =
    Math.floor(
      total / 60
    );


  $('timerSeconds').value =
    total % 60;
}


function syncTeamSelectors() {

  const teamCount =
    Number(
      game.teamCount ||
      4
    );


  const options =
    Array.from(
      {
        length:
          teamCount
      },
      (_, index) => {

        const team =
          index + 1;

        return `
          <option value="${team}">
            ${teamLabel(team)}
          </option>
        `;
      }
    ).join('');


  [
    'homeTeam',
    'awayTeam'
  ].forEach(
    id => {

      const select =
        $(id);

      const oldValue =
        select.value;

      select.innerHTML =
        options;


      if (
        oldValue &&
        Number(oldValue) <=
          teamCount
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
      teamCount
    );


  let away =
    Math.min(
      Number(
        game.activeAwayTeam ||
        2
      ),
      teamCount
    );


  if (
    away === home &&
    teamCount > 1
  ) {

    away =
      home === 1
        ? 2
        : 1;
  }


  $('homeTeam').value =
    String(home);


  $('awayTeam').value =
    String(away);


  renderGoalTeamOptions();
}


// ======================================================
// RENDER EVERYTHING
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

  const maximumPlayers =
    Number(
      game.teamCount ||
      4
    ) *
    Number(
      game.playersPerTeam ||
      5
    );


  $('adminCount').textContent =
    `${players.length}/${maximumPlayers} שחקנים`;


  if (
    players.length === 0
  ) {

    $('adminPlayers').innerHTML =
      '<span class="muted">אין שחקנים רשומים.</span>';

    return;
  }


  $('adminPlayers').innerHTML =
    players.map(
      player => `

        <div class="player-row">

          <span>

            <b>
              ${escapeHtml(player.name)}
            </b>

            <span class="pill">

              ${
                player.team
                  ? teamLabel(player.team)
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
    ).join('');


  document
    .querySelectorAll(
      '.remove'
    )
    .forEach(
      button => {

        button.onclick =
          async () => {

            if (
              !confirm(
                'להסיר את השחקן מהמשחק?'
              )
            ) {

              return;
            }


            await deleteDoc(
              doc(
                db,
                'games',
                GAME,
                'players',
                button.dataset.id
              )
            );
          };
      }
    );
}


// ======================================================
// TEAMS
// ======================================================

function renderTeams() {

  const teamCount =
    Number(
      game.teamCount ||
      4
    );


  $('adminTeams').innerHTML =
    Array
      .from(
        {
          length:
            teamCount
        },
        (_, index) => {

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
                members.length
                  ? members.map(
                      player => `

                        <div class="member">

                          <span>
                            ${escapeHtml(player.name)}
                          </span>

                          <select
                            class="select-inline move"
                            data-id="${player.id}"
                          >

                            ${
                              Array.from(
                                {
                                  length:
                                    teamCount
                                },
                                (_, teamIndex) => {

                                  const newTeam =
                                    teamIndex + 1;

                                  return `
                                    <option
                                      value="${newTeam}"
                                      ${
                                        newTeam === team
                                          ? 'selected'
                                          : ''
                                      }
                                    >
                                      ${teamLabel(newTeam)}
                                    </option>
                                  `;
                                }
                              ).join('')
                            }

                          </select>

                        </div>

                      `
                    ).join('')
                  : '<div class="member muted">הקבוצה ריקה</div>'
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
          async () => {

            await updateDoc(
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
          };
      }
    );
}


// ======================================================
// STATS
// ======================================================

function renderStats() {

  if (!$('statsRows')) {
    return;
  }


  $('statsRows').innerHTML =
    players.map(
      player => `

        <tr>

          <td>
            ${escapeHtml(player.name)}
          </td>

          <td>
            ${Number(player.goals || 0)}
          </td>

          <td>
            ${Number(player.assists || 0)}
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
    ).join('');
}


// ======================================================
// TIMER
// ======================================================

function renderTimer() {

  if (!$('timerDisplay')) {
    return;
  }


  const remaining =
    timerSecondsLeft();


  $('timerDisplay').textContent =
    formatTimer(
      remaining
    );


  $('timerDisplay')
    .classList
    .toggle(
      'timer-running',
      !!game.timerRunning &&
      remaining > 0
    );


  $('timerPauseBtn').disabled =
    !game.timerRunning;


  if (
    game.timerRunning &&
    remaining <= 0
  ) {

    finishTimer();
  }
}


function startTimerTicker() {

  if (timerInterval) {

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

  } catch (error) {

    console.error(
      'Timer finish error:',
      error
    );
  }


  $('timerMsg').textContent =
    'הזמן הסתיים ⏱️';
}


// START / RESUME TIMER

$('timerStartBtn').onclick =
  async () => {

    let remaining =
      timerSecondsLeft();


    if (
      remaining <= 0
    ) {

      const minutes =
        clamp(
          $('timerMinutes').value,
          0,
          180
        );


      const seconds =
        clamp(
          $('timerSeconds').value,
          0,
          59
        );


      remaining =
        minutes * 60 +
        seconds;
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


    await setDoc(
      gameRef,
      {
        timerDuration:
          Math.max(
            remaining,
            Number(
              game.timerDuration
            ) ||
            remaining
          ),

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
      'השעון הופעל.';
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

$('timerResetBtn').onclick =
  async () => {

    const minutes =
      clamp(
        $('timerMinutes').value,
        0,
        180
      );


    const seconds =
      clamp(
        $('timerSeconds').value,
        0,
        59
      );


    const total =
      minutes * 60 +
      seconds;


    if (
      total <= 0
    ) {

      $('timerMsg').textContent =
        'יש להגדיר זמן גדול מ־0.';

      return;
    }


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


    $('timerMsg').textContent =
      'השעון אופס לזמן שהוגדר.';
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
    teamLabel(home);


  $('awayTeamLabel').textContent =
    teamLabel(away);


  $('homeScore').textContent =
    currentScore(home);


  $('awayScore').textContent =
    currentScore(away);


  renderGoalTeamOptions();
}


// ======================================================
// GOAL TEAM OPTIONS
// ======================================================

function renderGoalTeamOptions() {

  if (!$('goalTeam')) {
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


  const previous =
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
      previous === away
        ? away
        : home
    );


  renderScorerOptions();
}


// ======================================================
// SCORER / ASSISTER OPTIONS
// ======================================================

function renderScorerOptions() {

  if (
    !$('scorer') ||
    !$('assister')
  ) {

    return;
  }


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
    members.map(
      player =>
        `
          <option value="${player.id}">
            ${escapeHtml(player.name)}
          </option>
        `
    ).join('');


  $('assister').innerHTML =
    '<option value="">ללא בישול</option>' +
    members.map(
      player =>
        `
          <option value="${player.id}">
            ${escapeHtml(player.name)}
          </option>
        `
    ).join('');
}


// ======================================================
// GOAL EVENTS
// ======================================================

function renderGoalEvents() {

  if (!$('goalEvents')) {
    return;
  }


  const goalEvents =
    events.filter(
      event =>
        event.type ===
        'goal'
    );


  if (
    goalEvents.length === 0
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
        event => `

          <div class="event-row">

            <div>

              <b>
                ⚽ ${escapeHtml(event.scorerName || 'לא ידוע')}
              </b>

              ·
              ${teamLabel(event.team)}

              ${
                event.assisterName
                  ? ` · בישול: ${escapeHtml(event.assisterName)}`
                  : ''
              }

              <div class="muted small">
                ${escapeHtml(event.timerText || '')}
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

  const teamCount =
    Number(
      game.teamCount ||
      4
    );


  if (
    players.length === 0
  ) {

    $('settingsMsg').textContent =
      'אין שחקנים להגרלה.';

    return;
  }


  const playerList =
    shuffled(
      players
    );


  const batch =
    writeBatch(db);


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
              teamCount
            ) +
            1
        }
      );
    }
  );


  await batch.commit();


  $('settingsMsg').textContent =
    'הקבוצות הוגרלו בהצלחה.';
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
    ].includes(team)
  ) {

    $('scoreMsg').textContent =
      'יש לבחור קבוצה שמשחקת כרגע.';

    return;
  }


  if (!scorerId) {

    $('scoreMsg').textContent =
      'יש לבחור מי כבש את הגול.';

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
    writeBatch(db);


  batch.update(
    gameRef,
    {
      [`scores.${team}`]:
        increment(1)
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
        increment(1)
    }
  );


  if (assister) {

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
          increment(1)
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

async function undoGoal(eventId) {

  const event =
    events.find(
      item =>
        item.id ===
          eventId &&
        item.type ===
          'goal'
    );


  if (!event) {
    return;
  }


  const currentTeamScore =
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
    writeBatch(db);


  batch.update(
    gameRef,
    {
      [`scores.${event.team}`]:
        Math.max(
          0,
          currentTeamScore - 1
        )
    }
  );


  if (scorer) {

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


  if (assister) {

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
// RESET SCORE + GOAL EVENTS
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


  const goalsByPlayer =
    {};


  const assistsByPlayer =
    {};


  goalEvents.forEach(
    event => {

      if (event.scorerId) {

        goalsByPlayer[
          event.scorerId
        ] =
          (
            goalsByPlayer[
              event.scorerId
            ] ||
            0
          ) +
          1;
      }


      if (event.assisterId) {

        assistsByPlayer[
          event.assisterId
        ] =
          (
            assistsByPlayer[
              event.assisterId
            ] ||
            0
          ) +
          1;
      }
    }
  );


  const batch =
    writeBatch(db);


  const scores =
    {};


  for (
    let team = 1;
    team <=
      Number(
        game.teamCount ||
        4
      );
    team++
  ) {

    scores[team] =
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
            goalsByPlayer[
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
            assistsByPlayer[
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
// ACTIVE MATCH TEAMS
// ======================================================

$('homeTeam').addEventListener(
  'change',
  () => {

    if (
      $('awayTeam').value ===
      $('homeTeam').value
    ) {

      const teamCount =
        Number(
          game.teamCount ||
          4
        );


      const home =
        Number(
          $('homeTeam').value
        );


      $('awayTeam').value =
        String(
          home === 1 &&
          teamCount > 1
            ? 2
            : 1
        );
    }
  }
);


$('awayTeam').addEventListener(
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


$('goalTeam').addEventListener(
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
// SHUFFLE
// ======================================================

$('shuffleBtn').onclick =
  shuffle;


// ======================================================
// REVEAL TEAMS
// ======================================================

$('revealBtn').onclick =
  async () => {

    if (
      players.length === 0
    ) {

      $('settingsMsg').textContent =
        'אין שחקנים רשומים.';

      return;
    }


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

    const teamCount =
      Number(
        $('teamCount').value
      );


    const playersPerTeam =
      Number(
        $('playersPerTeam').value
      );


    const scores =
      {
        ...(
          game.scores ||
          {}
        )
      };


    for (
      let team = 1;
      team <=
        teamCount;
      team++
    ) {

      if (
        scores[team] ==
        null
      ) {

        scores[team] =
          0;
      }
    }


    await setDoc(
      gameRef,
      {
        teamCount,
        playersPerTeam,

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
      writeBatch(db);


    playerSnapshot.forEach(
      item => {

        batch.delete(
          item.ref
        );
      }
    );


    eventSnapshot.forEach(
      item => {

        batch.delete(
          item.ref
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
      'המשחק אופס בהצלחה.';
  };


// ======================================================
// SAVE MATCH STATISTICS
// ======================================================

$('saveStats').onclick =
  async () => {

    if (
      players.length === 0
    ) {

      $('statsMsg').textContent =
        'אין שחקנים לשמירת סטטיסטיקה.';

      return;
    }


    if (
      !confirm(
        'לסיים את המשחק ולעדכן את הסטטיסטיקה של כל השחקנים?'
      )
    ) {

      return;
    }


    const batch =
      writeBatch(db);


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
// START LOCAL TIMER DISPLAY
// ======================================================

startTimerTicker();
