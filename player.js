import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDoc,
  setDoc,
  query,
  where,
  onSnapshot,
  doc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);
const bad = firebaseConfig.apiKey.startsWith('PASTE_');
if (bad) {
  $('setupError').classList.remove('hidden');
  $('joinBtn').disabled = true;
  throw new Error('Firebase not configured');
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
await signInAnonymously(auth);

const GAME = 'current';
let meId = localStorage.getItem('workgoalPlayerId') || '';
let permanentPlayerId =
  localStorage.getItem('workgoalPermanentPlayerId') || '';
let game = { teamCount: 4, playersPerTeam: 5, status: 'registration', activeHomeTeam: 1, activeAwayTeam: 2, scores: {} };
let players = [];
let timerInterval = null;

function target() { return Number(game.teamCount || 4) * Number(game.playersPerTeam || 5); }
function timerSecondsLeft() {
  if (game.timerRunning && game.timerEndAt) return Math.max(0, Math.ceil((Number(game.timerEndAt) - Date.now()) / 1000));
  return Math.max(0, Number(game.timerRemaining ?? game.timerDuration ?? 0));
}
function formatTimer(total) { total = Math.max(0, Math.floor(Number(total) || 0)); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function score(team) { return Number(game.scores?.[String(team)] ?? game.scores?.[team] ?? 0); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch])); }

async function getOrCreatePermanentPlayer(name) {

  const normalizedName =
    name.trim().toLowerCase();

  // אם כבר שמרנו את מזהה השחקן בדפדפן
  if (permanentPlayerId) {

    const existingRef =
      doc(
        db,
        'players',
        permanentPlayerId
      );

    const existingSnap =
      await getDoc(existingRef);

    if (existingSnap.exists()) {
      return {
        id: existingSnap.id,
        ...existingSnap.data()
      };
    }
  }

  // מחפש שחקן קיים לפי השם
  const existingPlayers =
    await getDocs(
      query(
        collection(db, 'players'),
        where(
          'nameLower',
          '==',
          normalizedName
        )
      )
    );

  if (!existingPlayers.empty) {

    const existing =
      existingPlayers.docs[0];

    permanentPlayerId =
      existing.id;

    localStorage.setItem(
      'workgoalPermanentPlayerId',
      permanentPlayerId
    );

    return {
      id: existing.id,
      ...existing.data()
    };
  }

  // אין שחקן כזה - יוצרים פרופיל חדש
  const newPlayerRef =
    await addDoc(
      collection(db, 'players'),
      {
        name,
        nameLower:
          normalizedName,

        goals:
          0,

        assists:
          0,

        games:
          0,

        wins:
          0,

        mvp:
          0,

        createdAt:
          serverTimestamp()
      }
    );

  permanentPlayerId =
    newPlayerRef.id;

  localStorage.setItem(
    'workgoalPermanentPlayerId',
    permanentPlayerId
  );

  return {
    id: newPlayerRef.id,
    name,
    nameLower:
      normalizedName,

    goals:
      0,

    assists:
      0,

    games:
      0,

    wins:
      0,

    mvp:
      0
  };
}
function render() {
  $('count').textContent = `${players.length}/${target()}`;
  $('regStatus').textContent = game.status === 'registration' ? 'ההרשמה פתוחה' : game.status === 'revealed' ? 'הקבוצות נחשפו' : 'המשחק הסתיים';
  const me = players.find(p => p.id === meId);
  const revealed = game.status === 'revealed' || game.status === 'finished';
  $('waiting').classList.toggle('hidden', revealed && !!me);
  $('myTeamCard').classList.toggle('hidden', !(revealed && me));
  $('profileCard').classList.toggle('hidden', !me);
  $('liveCard').classList.toggle('hidden', !revealed);

  const home = Number(game.activeHomeTeam || 1), away = Number(game.activeAwayTeam || 2);
  $('playerHomeLabel').textContent = `קבוצה ${home}`;
  $('playerAwayLabel').textContent = `קבוצה ${away}`;
  $('playerHomeScore').textContent = score(home);
  $('playerAwayScore').textContent = score(away);
  $('playerTimer').textContent = formatTimer(timerSecondsLeft());

  if (me) {
    $('profileName').textContent = me.name;
    $('profileTeam').textContent = me.team ? `קבוצה ${me.team}` : 'ממתין לשיבוץ';
    $('games').textContent = me.games || 0;
    $('goals').textContent = me.goals || 0;
    $('assists').textContent = me.assists || 0;
    $('mvp').textContent = me.mvp || 0;
    $('wins').textContent = me.wins || 0;
    const g = me.games || 0;
    $('winRate').textContent = g ? Math.round((me.wins || 0) / g * 100) + '%' : '0%';
    if (revealed) {
      const mates = players.filter(p => Number(p.team) === Number(me.team));
      $('myTeam').innerHTML = `<div class="team"><h3>קבוצה ${me.team}</h3>${mates.map(p => `<div class="member">${escapeHtml(p.name)}${p.id === me.id ? ' ⭐' : ''}</div>`).join('')}</div>`;
    }
  }
}

onSnapshot(doc(db, 'games', GAME), snap => { if (snap.exists()) { game = { ...game, ...snap.data() }; render(); } });
onSnapshot(collection(db, 'games', GAME, 'players'), snap => { players = snap.docs.map(d => ({ id: d.id, ...d.data() })); render(); });

$('joinBtn').addEventListener('click', async () => {
  const name = $('fullName').value.trim();
  $('joinMsg').classList.remove('hidden');
  if (game.status !== 'registration') { $('joinMsg').textContent = 'ההרשמה סגורה.'; return; }
  if (name.length < 3) { $('joinMsg').textContent = 'נא להזין שם מלא.'; return; }
  if (players.length >= target()) { $('joinMsg').textContent = 'ההרשמה מלאה.'; return; }
  const dup = await getDocs(query(collection(db, 'games', GAME, 'players'), where('nameLower', '==', name.toLowerCase())));
  if (!dup.empty) { $('joinMsg').textContent = 'השם הזה כבר רשום.'; return; }
 const permanentPlayer =
  await getOrCreatePermanentPlayer(
    name
  );

const ref =
  await addDoc(
    collection(
      db,
      'games',
      GAME,
      'players'
    ),
    {
      permanentPlayerId:
        permanentPlayer.id,

      name:
        permanentPlayer.name,

      nameLower:
        permanentPlayer.nameLower,

      team:
        null,

      goals:
        0,

      assists:
        0,

      mvp:
        0,

      games:
        0,

      wins:
        0,

      createdAt:
        serverTimestamp()
    }
  );
  meId = ref.id;
  localStorage.setItem('workgoalPlayerId', meId);
  $('joinMsg').textContent = 'נרשמת בהצלחה ✅';
  $('fullName').value = '';
});

timerInterval = setInterval(() => { if (!$('liveCard').classList.contains('hidden')) $('playerTimer').textContent = formatTimer(timerSecondsLeft()); }, 250);
