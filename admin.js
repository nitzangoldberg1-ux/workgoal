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


// =========================
// GAME STATE
// =========================

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


// =========================
// FIRESTORE LISTENERS
// =========================

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


  // GAME

  unsubscribeGame = onSnapshot(

    gameRef,

    async snap => {

      if (snap.exists()) {

        game = {
          ...game,
          ...snap.data()
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


  // PLAYERS

  unsubscribePlayers = onSnapshot(

    collection(
      db,
      'games',
      GAME,
      'players'
    ),

    snap => {

      players =
        snap.docs.map(
          d => ({
            id: d.id,
            ...d.data()
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

  unsubscribeEvents = onSnapshot(

    collection(
      db,
      'games',
      GAME,
      'events'
    ),

    snap => {

      events =
        snap.docs
          .map(
            d => ({
              id: d.id,
              ...d.data()
            })
          )
          .sort(
            (a, b) =>
              Number(
                a.createdAtMs || 0
              ) -
              Number(
                b.createdAtMs || 0
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


// =========================
// ADMIN LOGIN
// =========================

$('loginBtn').addEventListener(
  'click',
  async () => {

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
        (result.user.email || '')
          .trim()
          .toLowerCase();


      const allowedEmail =
        (ADMIN_EMAIL || '')
          .trim()
          .toLowerCase();


      if (
        loggedEmail !==
        allowedEmail
      ) {

        await signOut(auth);

        $('loginMsg').textContent =
          'החשבון הזה אינו מורשה כמנהל.';

        return;
      }


      $('loginMsg').textContent = '';

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
            'Email/Password לא מופעל ב-Firebase Authentication.';

          break;


        case 'auth/too-many-requests':

          $('loginMsg').textContent =
            'יותר מדי ניסיונות התחברות. נסה שוב מאוחר יותר.';

          break;


        default:

          $('loginMsg').textContent =
            'שגיאת התחברות: ' +
            (
              error.code ||
              error.message
            );

      }
    }
  }
);


// ENTER ON PASSWORD

$('password').addEventListener(
  'keydown',
  event => {

    if (event.key === 'Enter') {

      $('loginBtn').click();

    }
  }
);


// LOGOUT

$('logoutBtn').addEventListener(
  'click',
  async () => {

    stopAdminListeners();

    await signOut(auth);

  }
);


// AUTH STATE

onAuthStateChanged(
  auth,
  async user => {

    const isAdmin =
      !!user?.email &&
      user.email.trim().toLowerCase() ===
        (ADMIN_EMAIL || '').trim().toLowerCase();


    $('loginCard')
      .classList
      .toggle(
        'hidden',
        !!isAdmin
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


// =========================
// HELPERS
// =========================

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

  array =
    [...array];

  for (
    let i =
      array.length - 1;
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
      array[i],
      array[j]
    ] =
    [
      array[j],
      array[i]
    ];
  }

  return array;
}


// =========================
// SETTINGS
// =========================

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

  const n =
    Number(
      game.teamCount ||
      4
    );


  const options =
    Array
      .from(
        {
          length: n
        },
        (
          _,
          index
        ) =>
          `<option value="${index + 1}">
            ${teamLabel(index + 1)}
          </option>`
      )
      .join('');


  [
    'homeTeam',
    'awayTeam'
  ].forEach(
    id => {

      const select =
        $(id);

      const old =
        select.value;

      select.innerHTML =
        options;

      if (
        old &&
        Number(old) <= n
      ) {

        select.value =
          old;
      }
    }
  );


  $('homeTeam').value =
    String(
      Math.min(
        Number(
          game.activeHomeTeam ||
          1
        ),
        n
      )
    );


  let away =
    Math.min(
      Number(
        game.activeAwayTeam ||
        2
      ),
      n
    );


  if (
    away ===
      Number(
        $('homeTeam').value
      ) &&
    n > 1
  ) {

    away =
      Number(
        $('homeTeam').value
      ) === 1
        ? 2
        : 1;
  }


  $('awayTeam').value =
    String(
      away
    );


  renderGoalTeamOptions();
}


// =========================
// RENDER ALL
// =========================

function renderAll() {

  renderPlayers();

  renderTeams();

  renderStats();

  renderTimer();

  renderScoreboard();

  renderGoalEvents();
}


// =========================
// PLAYERS
// =========================

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
        player => `

          <div class="player-row">

            <span>

              <b>
                ${escapeHtml(player.name)}
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


// =========================
// TEAMS
// =========================

function renderTeams() {

  const n =
    Number(
      game.teamCount ||
      4
    );


  $('adminTeams').innerHTML =
    Array
      .from(
        {
          length: n
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
                    player => `

                      <div class="member">

                        ${escapeHtml(player.name)}

                        <select
                          class="select-inline move"
                          data-id="${player.id}"
                        >

                          ${
                            Array
                              .from(
                                {
                                  length: n
                                },
                                (
                                  _,
                                  teamIndex
                                ) =>
                                  `
                                    <option
                                      value="${teamIndex + 1}"
                                      ${
                                        teamIndex + 1 === team
                                          ? 'selected'
                                          : ''
                                      }
                                    >
                                      ${teamLabel(teamIndex + 1)}
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

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
