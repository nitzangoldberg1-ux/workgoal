import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import { getFirestore, collection, doc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, serverTimestamp, increment } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';
import { firebaseConfig, ADMIN_EMAIL } from './firebase-config.js';

const $ = id => document.getElementById(id);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const GAME = 'current';
const gameRef = doc(db, 'games', GAME);

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
  scores: { 1: 0, 2: 0, 3: 0, 4: 0 }
};
let players = [];
let events = [];
let timerInterval = null;

$('loginBtn').addEventListener('click', async () => {
  try {
    await signInWithEmailAndPassword(auth, $('email').value, $('password').value);
    $('loginMsg').textContent = '';
  } catch {
    $('loginMsg').textContent = 'פרטי כניסה שגויים או Firebase Auth לא הוגדר.';
  }
});
$('logoutBtn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, user => {
  const ok = user && user.email === ADMIN_EMAIL;
  $('loginCard').classList.toggle('hidden', ok);
  $('adminApp').classList.toggle('hidden', !ok);
  $('logoutBtn').classList.toggle('hidden', !ok);
  if (user && !ok) {
    $('loginMsg').textContent = 'החשבון הזה אינו מנהל.';
    signOut(auth);
  }
});

onSnapshot(gameRef, snap => {
  if (snap.exists()) game = { ...game, ...snap.data() };
  else setDoc(gameRef, game);
  syncSettings();
  renderAll();
});

onSnapshot(collection(db, 'games', GAME, 'players'), snap => {
  players = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderAll();
});

onSnapshot(collection(db, 'games', GAME, 'events'), snap => {
  events = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0));
  renderGoalEvents();
});

function teamLabel(team) { return `קבוצה ${team}`; }
function currentScore(team) { return Number(game.scores?.[String(team)] ?? game.scores?.[team] ?? 0); }
function clamp(v, min, max) { v = Number(v); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min; }
function formatTimer(total) { total = Math.max(0, Math.floor(Number(total) || 0)); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function timerSecondsLeft() {
  if (game.timerRunning && game.timerEndAt) return Math.max(0, Math.ceil((Number(game.timerEndAt) - Date.now()) / 1000));
  return Math.max(0, Number(game.timerRemaining ?? game.timerDuration ?? 0));
}
function shuffled(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function syncSettings() {
  $('teamCount').value = String(game.teamCount || 4);
  $('playersPerTeam').value = String(game.playersPerTeam || 5);
  $('gameStatus').value = game.status || 'registration';
  syncTimerInputs();
  syncTeamSelectors();
}

function syncTimerInputs() {
  const total = Math.max(0, Number(game.timerDuration ?? 600));
  $('timerMinutes').value = Math.floor(total / 60);
  $('timerSeconds').value = total % 60;
}

function syncTeamSelectors() {
  const n = Number(game.teamCount || 4);
  const opts = Array.from({ length: n }, (_, i) => `<option value="${i + 1}">${teamLabel(i + 1)}</option>`).join('');
  ['homeTeam', 'awayTeam'].forEach(id => {
    const select = $(id);
    const old = select.value;
    select.innerHTML = opts;
    if (old && Number(old) <= n) select.value = old;
  });
  $('homeTeam').value = String(Math.min(Number(game.activeHomeTeam || 1), n));
  let away = Math.min(Number(game.activeAwayTeam || 2), n);
  if (away === Number($('homeTeam').value) && n > 1) away = Number($('homeTeam').value) === 1 ? 2 : 1;
  $('awayTeam').value = String(away);
  renderGoalTeamOptions();
}

function renderAll() {
  renderPlayers();
  renderTeams();
  renderStats();
  renderTimer();
  renderScoreboard();
  renderGoalEvents();
}

function renderPlayers() {
  const target = Number(game.teamCount || 4) * Number(game.playersPerTeam || 5);
  $('adminCount').textContent = `${players.length}/${target} שחקנים`;
  $('adminPlayers').innerHTML = players.map(p => `
    <div class="player-row">
      <span><b>${escapeHtml(p.name)}</b> <span class="pill">${p.team ? teamLabel(p.team) : 'ללא קבוצה'}</span></span>
      <button class="danger small remove" data-id="${p.id}">הסר</button>
    </div>`).join('') || '<span class="muted">אין שחקנים.</span>';
  document.querySelectorAll('.remove').forEach(b => b.onclick = () => deleteDoc(doc(db, 'games', GAME, 'players', b.dataset.id)));
}

function renderTeams() {
  const n = Number(game.teamCount || 4);
  $('adminTeams').innerHTML = Array.from({ length: n }, (_, i) => {
    const t = i + 1;
    const members = players.filter(p => Number(p.team) === t);
    return `<div class="team"><h3>${teamLabel(t)}</h3>${members.map(p => `
      <div class="member">${escapeHtml(p.name)}
        <select class="select-inline move" data-id="${p.id}">
          ${Array.from({ length: n }, (_, j) => `<option value="${j + 1}" ${j + 1 === t ? 'selected' : ''}>${teamLabel(j + 1)}</option>`).join('')}
        </select>
      </div>`).join('') || '<div class="member muted">ריקה</div>'}</div>`;
  }).join('');
  document.querySelectorAll('.move').forEach(s => s.onchange = () => updateDoc(doc(db, 'games', GAME, 'players', s.dataset.id), { team: Number(s.value) }));
}

function renderStats() {
  $('statsRows').innerHTML = players.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${Number(p.goals || 0)}</td>
      <td>${Number(p.assists || 0)}</td>
      <td><input type="checkbox" data-id="${p.id}" class="sm"></td>
      <td><input type="checkbox" data-id="${p.id}" class="sw"></td>
    </tr>`).join('');
}

function renderTimer() {
  if (!$('timerDisplay')) return;
  const left = timerSecondsLeft();
  $('timerDisplay').textContent = formatTimer(left);
  $('timerDisplay').classList.toggle('timer-running', !!game.timerRunning && left > 0);
  $('timerPauseBtn').disabled = !game.timerRunning;
  if (game.timerRunning && left <= 0) finishTimer();
}

function startTimerTicker() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(renderTimer, 250);
}

async function finishTimer() {
  if (!game.timerRunning) return;
  game.timerRunning = false;
  game.timerRemaining = 0;
  game.timerEndAt = null;
  renderTimer();
  try { await updateDoc(gameRef, { timerRunning: false, timerRemaining: 0, timerEndAt: null }); } catch {}
  $('timerMsg').textContent = 'הזמן הסתיים ⏱️';
}

function renderScoreboard() {
  const home = Number(game.activeHomeTeam || 1);
  const away = Number(game.activeAwayTeam || 2);
  $('homeTeamLabel').textContent = teamLabel(home);
  $('awayTeamLabel').textContent = teamLabel(away);
  $('homeScore').textContent = currentScore(home);
  $('awayScore').textContent = currentScore(away);
  renderGoalTeamOptions();
}

function renderGoalTeamOptions() {
  if (!$('goalTeam')) return;
  const home = Number(game.activeHomeTeam || 1);
  const away = Number(game.activeAwayTeam || 2);
  const old = Number($('goalTeam').value || home);
  $('goalTeam').innerHTML = `<option value="${home}">${teamLabel(home)}</option><option value="${away}">${teamLabel(away)}</option>`;
  $('goalTeam').value = String(old === away ? away : home);
  renderScorerOptions();
}

function renderScorerOptions() {
  const team = Number($('goalTeam')?.value || game.activeHomeTeam || 1);
  const members = players.filter(p => Number(p.team) === team);
  $('scorer').innerHTML = '<option value="">בחר כובש</option>' + members.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  $('assister').innerHTML = '<option value="">ללא בישול</option>' + members.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
}

function renderGoalEvents() {
  if (!$('goalEvents')) return;
  const goalEvents = events.filter(e => e.type === 'goal');
  if (!goalEvents.length) {
    $('goalEvents').innerHTML = '<span class="muted">עדיין אין אירועי גול.</span>';
    return;
  }
  $('goalEvents').innerHTML = [...goalEvents].reverse().map(e => `
    <div class="event-row">
      <div><b>⚽ ${escapeHtml(e.scorerName || 'לא ידוע')}</b> · ${teamLabel(e.team)}${e.assisterName ? ` · בישול: ${escapeHtml(e.assisterName)}` : ''}<div class="muted small">${escapeHtml(e.timerText || '')}</div></div>
      <button class="danger small undo-goal" data-id="${e.id}">בטל גול</button>
    </div>`).join('');
  document.querySelectorAll('.undo-goal').forEach(b => b.onclick = () => undoGoal(b.dataset.id));
}

async function shuffle() {
  const n = Number(game.teamCount || 4);
  const list = shuffled(players);
  const batch = writeBatch(db);
  list.forEach((p, i) => batch.update(doc(db, 'games', GAME, 'players', p.id), { team: (i % n) + 1 }));
  await batch.commit();
  $('settingsMsg').textContent = 'הקבוצות הוגרלו.';
}

async function addGoal() {
  const team = Number($('goalTeam').value);
  const scorerId = $('scorer').value;
  const assisterId = $('assister').value;
  const home = Number(game.activeHomeTeam || 1);
  const away = Number(game.activeAwayTeam || 2);
  if (![home, away].includes(team)) { $('scoreMsg').textContent = 'יש לבחור קבוצה שמשחקת כרגע.'; return; }
  const scorer = players.find(p => p.id === scorerId);
  const assister = assisterId ? players.find(p => p.id === assisterId) : null;
  if (!scorer || Number(scorer.team) !== team) { $('scoreMsg').textContent = 'יש לבחור כובש מהקבוצה הנכונה.'; return; }
  if (assister && Number(assister.team) !== team) { $('scoreMsg').textContent = 'המבשל חייב להיות מאותה קבוצה.'; return; }
  if (assisterId && assisterId === scorerId) { $('scoreMsg').textContent = 'כובש לא יכול לבשל לעצמו.'; return; }

  const eventRef = doc(collection(db, 'games', GAME, 'events'));
  const batch = writeBatch(db);
  batch.update(gameRef, { [`scores.${team}`]: increment(1) });
  batch.update(doc(db, 'games', GAME, 'players', scorerId), { goals: increment(1) });
  if (assister) batch.update(doc(db, 'games', GAME, 'players', assister.id), { assists: increment(1) });
  batch.set(eventRef, {
    type: 'goal', team, scorerId, scorerName: scorer.name,
    assisterId: assister?.id || null, assisterName: assister?.name || null,
    timerRemaining: timerSecondsLeft(), timerText: formatTimer(timerSecondsLeft()),
    createdAt: serverTimestamp(), createdAtMs: Date.now()
  });
  await batch.commit();
  $('scoreMsg').textContent = `גול ל${teamLabel(team)} — ${scorer.name} ⚽`;
  $('scorer').value = '';
  $('assister').value = '';
}

async function undoGoal(eventId) {
  const e = events.find(x => x.id === eventId && x.type === 'goal');
  if (!e) return;
  const score = currentScore(e.team);
  const scorer = players.find(p => p.id === e.scorerId);
  const assister = e.assisterId ? players.find(p => p.id === e.assisterId) : null;
  const batch = writeBatch(db);
  batch.update(gameRef, { [`scores.${e.team}`]: Math.max(0, score - 1) });
  if (scorer) batch.update(doc(db, 'games', GAME, 'players', scorer.id), { goals: Math.max(0, Number(scorer.goals || 0) - 1) });
  if (assister) batch.update(doc(db, 'games', GAME, 'players', assister.id), { assists: Math.max(0, Number(assister.assists || 0) - 1) });
  batch.delete(doc(db, 'games', GAME, 'events', eventId));
  await batch.commit();
  $('scoreMsg').textContent = 'הגול בוטל והסטטיסטיקה עודכנה.';
}

async function resetScoreAndEvents() {
  if (!confirm('לאפס את התוצאה ולמחוק את כל אירועי הגולים של המשחק?')) return;
  const goalEvents = events.filter(e => e.type === 'goal');
  const goalByPlayer = {};
  const assistByPlayer = {};
  goalEvents.forEach(e => {
    goalByPlayer[e.scorerId] = (goalByPlayer[e.scorerId] || 0) + 1;
    if (e.assisterId) assistByPlayer[e.assisterId] = (assistByPlayer[e.assisterId] || 0) + 1;
  });
  const batch = writeBatch(db);
  const scores = {};
  for (let i = 1; i <= Number(game.teamCount || 4); i++) scores[i] = 0;
  batch.update(gameRef, { scores });
  players.forEach(p => {
    const goals = Math.max(0, Number(p.goals || 0) - Number(goalByPlayer[p.id] || 0));
    const assists = Math.max(0, Number(p.assists || 0) - Number(assistByPlayer[p.id] || 0));
    batch.update(doc(db, 'games', GAME, 'players', p.id), { goals, assists });
  });
  goalEvents.forEach(e => batch.delete(doc(db, 'games', GAME, 'events', e.id)));
  await batch.commit();
  $('scoreMsg').textContent = 'התוצאה ואירועי הגולים אופסו.';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

$('timerStartBtn').onclick = async () => {
  let remaining = timerSecondsLeft();
  if (!game.timerRunning) {
    if (remaining <= 0) {
      const mins = clamp($('timerMinutes').value, 0, 180), secs = clamp($('timerSeconds').value, 0, 59);
      remaining = mins * 60 + secs;
    }
    if (remaining <= 0) { $('timerMsg').textContent = 'יש להגדיר זמן גדול מ־0.'; return; }
    const endAt = Date.now() + remaining * 1000;
    await setDoc(gameRef, { timerDuration: Math.max(remaining, Number(game.timerDuration) || remaining), timerRemaining: remaining, timerRunning: true, timerEndAt: endAt }, { merge: true });
    $('timerMsg').textContent = 'השעון הופעל.';
  }
};

$('timerPauseBtn').onclick = async () => {
  if (!game.timerRunning) return;
  const remaining = timerSecondsLeft();
  await updateDoc(gameRef, { timerRunning: false, timerRemaining: remaining, timerEndAt: null });
  $('timerMsg').textContent = 'השעון נעצר.';
};

$('timerResetBtn').onclick = async () => {
  const mins = clamp($('timerMinutes').value, 0, 180), secs = clamp($('timerSeconds').value, 0, 59), total = mins * 60 + secs;
  if (total <= 0) { $('timerMsg').textContent = 'יש להגדיר זמן גדול מ־0.'; return; }
  await setDoc(gameRef, { timerDuration: total, timerRemaining: total, timerRunning: false, timerEndAt: null }, { merge: true });
  $('timerMsg').textContent = 'השעון אופס לזמן שהוגדר.';
};

$('homeTeam').addEventListener('change', () => {
  if ($('awayTeam').value === $('homeTeam').value) {
    const n = Number(game.teamCount || 4);
    $('awayTeam').value = String(Number($('homeTeam').value) === 1 && n > 1 ? 2 : 1);
  }
});
$('awayTeam').addEventListener('change', () => {
  if ($('awayTeam').value === $('homeTeam').value) $('scoreMsg').textContent = 'יש לבחור שתי קבוצות שונות.';
});
$('goalTeam').addEventListener('change', renderScorerOptions);
$('addGoalBtn').onclick = addGoal;
$('resetScoreBtn').onclick = resetScoreAndEvents;
$('saveMatchupBtn').onclick = async () => {
  const home = Number($('homeTeam').value), away = Number($('awayTeam').value);
  if (home === away) { $('scoreMsg').textContent = 'יש לבחור שתי קבוצות שונות.'; return; }
  await setDoc(gameRef, { activeHomeTeam: home, activeAwayTeam: away }, { merge: true });
  $('scoreMsg').textContent = `${teamLabel(home)} נגד ${teamLabel(away)} נשמר.`;
};

$('shuffleBtn').onclick = shuffle;
$('revealBtn').onclick = async () => {
  if (players.some(p => !p.team)) await shuffle();
  await updateDoc(gameRef, { status: 'revealed' });
  $('settingsMsg').textContent = 'הקבוצות נחשפו לכל השחקנים ✅';
};
$('saveSettings').onclick = async () => {
  const n = Number($('teamCount').value);
  const scores = { ...(game.scores || {}) };
  for (let i = 1; i <= n; i++) if (scores[i] == null) scores[i] = 0;
  await setDoc(gameRef, { teamCount: n, playersPerTeam: Number($('playersPerTeam').value), status: $('gameStatus').value, scores }, { merge: true });
  $('settingsMsg').textContent = 'ההגדרות נשמרו.';
};
$('resetBtn').onclick = async () => {
  if (!confirm('לאפס את המשחק ולמחוק את כל הנרשמים והאירועים?')) return;
  const playerSnap = await getDocs(collection(db, 'games', GAME, 'players'));
  const eventSnap = await getDocs(collection(db, 'games', GAME, 'events'));
  const batch = writeBatch(db);
  playerSnap.forEach(d => batch.delete(d.ref));
  eventSnap.forEach(d => batch.delete(d.ref));
  batch.set(gameRef, { teamCount: 4, playersPerTeam: 5, status: 'registration', timerDuration: 600, timerRemaining: 600, timerRunning: false, timerEndAt: null, activeHomeTeam: 1, activeAwayTeam: 2, scores: { 1: 0, 2: 0, 3: 0, 4: 0 } });
  await batch.commit();
};
$('saveStats').onclick = async () => {
  const batch = writeBatch(db);
  for (const p of players) {
    const mvp = document.querySelector(`.sm[data-id="${p.id}"]`)?.checked ? 1 : 0;
    const win = document.querySelector(`.sw[data-id="${p.id}"]`)?.checked ? 1 : 0;
    batch.update(doc(db, 'games', GAME, 'players', p.id), { mvp: Number(p.mvp || 0) + mvp, wins: Number(p.wins || 0) + win, games: Number(p.games || 0) + 1 });
  }
  batch.update(gameRef, { status: 'finished', timerRunning: false, timerEndAt: null, timerRemaining: timerSecondsLeft() });
  await batch.commit();
  $('statsMsg').textContent = 'המשחק נשמר והסטטיסטיקה עודכנה ✅';
};

startTimerTicker();
