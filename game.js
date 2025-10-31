// CONFIG: 핵심 상수 조정 지점
const CONFIG = {
    CANVAS: { WIDTH: 800, HEIGHT: 500 },
    WORLD: { GROUND_Y: 430, GRAVITY: 2100 }, // px/s^2
    PLAYER: { SPEED: 300, JUMP_VELOCITY: 820, WIDTH: 36, HEIGHT: 44, MAX_JUMPS: 2 },
    SPRITE: {
        MODE: 'individual',
        WALK_RATE: 0.12,
        IDLE_RATE: 0.5,
        FILES: {
            idle1: '배터리도트캐릭터_대기모습1.png',
            idle2: '배터리도트캐릭터_대기모습2.png',
            walk1: '배터리도트캐릭터_걷기1.png',
            walk2: '배터리도트캐릭터_걷기2.png',
            jump: '배터리도트캐릭터_점프.png',
            hit: '배터리도트캐릭터_폭탄타격.png',
            heal: '배터리도트캐릭터_멘탈회복.png',
            mentalout: '배터리도트캐릭터_멘탈아웃.png'
        }
    },
    BACKGROUND: { IMAGE: '시청배경.png' },
    BOMBS: {
        NEAR_RADIUS: 160, // 근접 피해 시작 반경
        TOUCH_DAMAGE: 40,
        PROX_DAMAGE_MIN: 2, // 초당
        PROX_DAMAGE_MAX: 6, // 초당
        BASE_SPEED: 240, // px/s
        SPEED_RAMP: 0.035, // 초당 가속 계수
        GROUND_SPAWN: { BASE: 1.8, MIN: 0.7, RAMP: 0.015 }, // 초
        AIR_SPAWN: { BASE: 2.2, MIN: 0.8, RAMP: 0.012 }
    },
    COIN: { SPAWN_BASE: 1.6, SPAWN_MIN: 0.8, SPAWN_RAMP: 0.01, SCORE: 10, SIZE: 18 },
    ITEMS: {
        SPAWN_BASE: 8.0, SPAWN_MIN: 4.5, SPAWN_RAMP: 0.008,
        TYPES: [
            { key: 'intern', label: '일경험', heal: 25 },
            { key: 'mentor', label: '현직자멘토링', heal: 25 },
            { key: 'counsel', label: '취업상담', heal: 20 },
            { key: 'growth', label: '청년성장프로그램', heal: 30 },
        ]
    },
    UI: {
        TOAST_MS: 1500,
        CHEER_MS: 2000,
        DANGER_FLASH_PERIOD: 0.5
    },
    AUDIO: {
        ENABLED: true,
        VOLUME: 0.2,
        BGM_SRC: '배경음악.mp3',
        BGM_VOLUME: 0.08
    }
};

// 유틸
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => Math.random() * (b - a) + a;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// DOM 요소
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const appEl = document.getElementById('app');
const canvasWrap = document.getElementById('canvasWrap');
const scoreEl = document.getElementById('score');
const mentalPercentEl = document.getElementById('mentalPercent');
const batteryFill = document.getElementById('batteryFill');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const muteBtn = document.getElementById('muteBtn');
const soundOn = document.getElementById('soundOn');
const soundOff = document.getElementById('soundOff');
const startOverlay = document.getElementById('startOverlay');
const startOverlayBtn = document.getElementById('startOverlayBtn');
const pauseOverlay = document.getElementById('pauseOverlay');
const resumeBtn = document.getElementById('resumeBtn');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const finalScoreEl = document.getElementById('finalScore');
const finalCoinsEl = document.getElementById('finalCoins');
const finalTimeEl = document.getElementById('finalTime');
const newBestEl = document.getElementById('newBest');
const shareLineEl = document.getElementById('shareLine');
const shareBtn = document.getElementById('shareBtn');
const playAgainBtn = document.getElementById('playAgainBtn');
const toastEl = document.getElementById('toast');
const cheerEl = document.getElementById('cheer');

// 개별 이미지 로더
const images = { idle1: null, idle2: null, walk1: null, walk2: null, jump: null, hit: null, heal: null, mentalout: null };
let assetsReady = false;
let bgImage = null, bgReady = false;
(function preloadIndividual() {
    const files = CONFIG.SPRITE.FILES;
    const keys = Object.keys(images);
    let remain = keys.length + 1; // + background
    keys.forEach((k) => {
        const img = new Image();
        img.src = files[k];
        img.onload = () => { images[k] = img; if (--remain === 0) { assetsReady = true; bgReady = true; } };
        img.onerror = () => { images[k] = img; if (--remain === 0) { assetsReady = true; bgReady = !!bgImage; } };
    });
    const bg = new Image();
    bg.src = CONFIG.BACKGROUND.IMAGE;
    bg.onload = () => { bgImage = bg; bgReady = true; if (--remain === 0) assetsReady = true; };
    bg.onerror = () => { bgImage = null; if (--remain === 0) assetsReady = true; };
})();

// 터치 컨트롤
const touchControls = document.getElementById('touchControls');
const btnLeft = document.getElementById('btnLeft');
const btnRight = document.getElementById('btnRight');
const btnJump = document.getElementById('btnJump');

// 오디오 매니저 (간단 WebAudio 톤)
class AudioManager {
    constructor() {
        this.muted = !CONFIG.AUDIO.ENABLED;
        this.ctx = null;
        this.bgm = null;
    }
    ensure() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }
    ensureBgm() {
        if (!CONFIG.AUDIO.BGM_SRC) return null;
        if (!this.bgm) {
            try {
                const el = new Audio(CONFIG.AUDIO.BGM_SRC);
                el.loop = true;
                el.preload = 'auto';
                el.volume = CONFIG.AUDIO.BGM_VOLUME;
                el.muted = this.muted;
                this.bgm = el;
            } catch {}
        }
        return this.bgm;
    }
    playBgm() {
        const el = this.ensureBgm();
        if (!el) return;
        el.play().catch(() => {});
    }
    pauseBgm() { if (this.bgm) this.bgm.pause(); }
    setBgmVolume(v) { if (this.bgm) this.bgm.volume = v; }
    beep(type = 'ui') {
        if (this.muted) return;
        this.ensure();
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        let freq = 440;
        let dur = 0.08;
        switch (type) {
            case 'coin': freq = 880; dur = 0.06; break;
            case 'item': freq = 520; dur = 0.12; break;
            case 'jump': freq = 600; dur = 0.08; break;
            case 'hit': freq = 180; dur = 0.12; break;
            case 'explode': freq = 120; dur = 0.18; break;
            default: freq = 440; dur = 0.07; break;
        }
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(CONFIG.AUDIO.VOLUME, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + dur);
    }
    toggleMute() { 
        this.muted = !this.muted; 
        if (this.bgm) this.bgm.muted = this.muted; 
    }
}
const audio = new AudioManager();

// 상태
const state = {
    running: false,
    paused: false,
    time: 0,
    lastTs: 0,
    dt: 0,
    score: 0,
    coins: 0,
    best: Number(localStorage.getItem('dreamrun_best_score') || 0),
    mental: 100,
    player: null,
    inputs: { left: false, right: false, jump: false },
    allowJump: true,
    bombs: [],
    coinsList: [],
    items: [],
    particles: [],
    spawn: {
        bombGround: 0, bombAir: 0, coin: 0, item: 0,
        elapsed: 0
    },
    nearDanger: false,
    survival: 0
};

function resetGame() {
    state.running = false;
    state.paused = false;
    state.time = 0;
    state.lastTs = 0;
    state.dt = 0;
    state.score = 0;
    state.coins = 0;
    state.mental = 100;
    state.player = {
        x: 120,
        y: CONFIG.WORLD.GROUND_Y - CONFIG.PLAYER.HEIGHT,
        vx: 0,
        vy: 0,
        onGround: true,
        jumpCount: 0,
        hitTimer: 0,
        healTimer: 0,
        frameTime: 0,
        facing: 1,
        state: 'idle' // idle, walk, jump, hit, win
    };
    state.inputs = { left: false, right: false, jump: false };
    state.allowJump = true;
    state.bombs = [];
    state.coinsList = [];
    state.items = [];
    state.particles = [];
    state.spawn = { bombGround: 0, bombAir: 0, coin: 0, item: 0, elapsed: 0 };
    state.nearDanger = false;
    state.survival = 0;
    updateHUD();
    canvasWrap.classList.remove('danger');
}

// HUD 업데이트
function updateHUD() {
    scoreEl.textContent = String(state.score);
    const m = clamp(state.mental, 0, 100);
    mentalPercentEl.textContent = String(Math.round(m));
    const maxFill = 44; // svg battery inner width
    batteryFill.setAttribute('width', String((maxFill * m) / 100));
    const color = m > 60 ? '#7cf' : (m > 30 ? '#ffd54a' : '#ff7a7f');
    batteryFill.setAttribute('fill', color);
}

// 입력 처리
function setupInputs() {
    window.addEventListener('keydown', (e) => {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') { state.inputs.left = true; }
        if (e.code === 'ArrowRight' || e.code === 'KeyD') { state.inputs.right = true; }
        if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') {
            e.preventDefault();
            state.inputs.jump = true;
        }
        if (e.code === 'KeyP') { togglePause(); }
        if (e.code === 'KeyM') { toggleMute(); }
    }, { passive: false });
    window.addEventListener('keyup', (e) => {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') { state.inputs.left = false; }
        if (e.code === 'ArrowRight' || e.code === 'KeyD') { state.inputs.right = false; }
        if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') { state.inputs.jump = false; state.allowJump = true; }
    });

    // 터치 컨트롤 활성화 탐지
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        appEl.classList.add('touch-enabled');
        touchControls.hidden = false;
    }
    const bindHold = (el, on, off) => {
        const down = (ev) => { ev.preventDefault(); on(); };
        const up = (ev) => { ev.preventDefault(); off(); };
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('pointerleave', up);
    };
    if (btnLeft && btnRight && btnJump) {
        bindHold(btnLeft, () => state.inputs.left = true, () => state.inputs.left = false);
        bindHold(btnRight, () => state.inputs.right = true, () => state.inputs.right = false);
        btnJump.addEventListener('pointerdown', (e) => { e.preventDefault(); triggerJump(); });
        const resetAllow = (e) => { e.preventDefault(); state.allowJump = true; };
        btnJump.addEventListener('pointerup', resetAllow);
        btnJump.addEventListener('pointercancel', resetAllow);
        btnJump.addEventListener('pointerleave', resetAllow);
    }

    // 화면 제스처: 하단 영역 홀드 이동(좌/우), 스와이프 업 점프
    const activePointers = new Map();
    const getZone = (x, y) => {
        const rect = canvasWrap.getBoundingClientRect();
        const rx = (x - rect.left) / rect.width;
        const ry = (y - rect.top) / rect.height;
        return { rx, ry };
    };
    const updateDirFrom = (rx, ry, phase) => {
        // 하단 40% 영역에서만 방향 입력 활성화
        if (ry >= 0.60) {
            if (rx <= 0.35) { state.inputs.left = true; state.inputs.right = false; }
            else if (rx >= 0.65) { state.inputs.right = true; state.inputs.left = false; }
        } else if (phase === 'end') {
            state.inputs.left = false; state.inputs.right = false;
        }
    };
    const onPD = (ev) => {
        if (startOverlay.hidden === false || gameOverOverlay.hidden === false) return;
        const { rx, ry } = getZone(ev.clientX, ev.clientY);
        activePointers.set(ev.pointerId, { sx: ev.clientX, sy: ev.clientY, t: performance.now(), usedDir: false });
        updateDirFrom(rx, ry, 'start');
    };
    const onPM = (ev) => {
        const data = activePointers.get(ev.pointerId); if (!data) return;
        const { rx, ry } = getZone(ev.clientX, ev.clientY);
        updateDirFrom(rx, ry, 'move');
    };
    const onPU = (ev) => {
        const data = activePointers.get(ev.pointerId); if (data) {
            const dx = ev.clientX - data.sx; const dy = ev.clientY - data.sy;
            const dt = performance.now() - data.t;
            // 스와이프 업 판정(짧은 시간 내 위로 40px 이상)
            if (-dy > 40 && dt < 400) triggerJump();
            else {
                // 하단 중앙 탭 점프(0.35~0.65)
                const { rx, ry } = getZone(ev.clientX, ev.clientY);
                if (ry >= 0.60 && rx > 0.35 && rx < 0.65 && dt < 250 && Math.hypot(dx, dy) < 20) triggerJump();
            }
        }
        activePointers.delete(ev.pointerId);
        state.inputs.left = false; state.inputs.right = false;
        state.allowJump = true;
    };
    canvasWrap.addEventListener('pointerdown', onPD);
    window.addEventListener('pointermove', onPM);
    window.addEventListener('pointerup', onPU);
    window.addEventListener('pointercancel', onPU);

    // 모바일에서 길게 누를 때 메뉴/텍스트 선택 방지
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        const block = (e) => e.preventDefault();
        ['contextmenu', 'selectstart'].forEach(ev => {
            document.addEventListener(ev, block, { passive: false });
            canvasWrap.addEventListener(ev, block, { passive: false });
        });
        // iOS Safari 보완
        try {
            document.body.style.webkitTouchCallout = 'none';
            document.body.style.webkitUserSelect = 'none';
        } catch {}
    }
}

// 점프 트리거(단일 점프)
function triggerJump() {
    const p = state.player;
    // 이단점프: 지면에서 1회, 공중에서 추가 1회
    if (state.allowJump && p.jumpCount < CONFIG.PLAYER.MAX_JUMPS) {
        p.vy = -CONFIG.PLAYER.JUMP_VELOCITY;
        p.onGround = false;
        p.state = 'jump';
        p.jumpCount += 1;
        state.allowJump = false;
        audio.beep('jump');
    }
}

// 게임 컨트롤 버튼
startBtn.addEventListener('click', () => openStart());
restartBtn.addEventListener('click', () => openStart());
startOverlayBtn.addEventListener('click', () => startGame());
resumeBtn.addEventListener('click', () => togglePause(false));
playAgainBtn.addEventListener('click', () => { hideOverlays(); openStart(); });
shareBtn.addEventListener('click', async () => {
    try {
        const text = shareLineEl.textContent || '';
        if (navigator.share) {
            await navigator.share({ text, title: '드림런' });
        } else {
            const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text);
            window.open(url, '_blank');
        }
    } catch {}
});

function toggleMute() {
    audio.toggleMute();
    const pressed = audio.muted;
    muteBtn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    soundOn.hidden = pressed;
    soundOff.hidden = !pressed;
}
muteBtn.addEventListener('click', toggleMute);

function openStart() {
    resetGame();
    startBtn.hidden = true;
    restartBtn.hidden = true;
    startOverlay.hidden = false;
}
function startGame() {
    startOverlay.hidden = true;
    gameOverOverlay.hidden = true;
    state.running = true;
    state.paused = false;
    startBtn.hidden = true;
    restartBtn.hidden = false;
    state.lastTs = performance.now();
    // 배경음악 시작 (낮은 볼륨)
    audio.playBgm();
    requestAnimationFrame(frame);
}
function togglePause(force) {
    if (!state.running) return;
    const next = typeof force === 'boolean' ? force : !state.paused;
    state.paused = next;
    pauseOverlay.hidden = !state.paused;
    // 일시정지 시 배경음은 유지(원하면 여기서 audio.pauseBgm() 호출)
}
function hideOverlays() {
    startOverlay.hidden = true;
    pauseOverlay.hidden = true;
    gameOverOverlay.hidden = true;
}

// 스폰 및 엔티티
function spawnBomb(type) {
    const speedMul = 1 + state.spawn.elapsed * CONFIG.BOMBS.SPEED_RAMP;
    const baseSpeed = CONFIG.BOMBS.BASE_SPEED * speedMul;
    const h = CONFIG.CANVAS.HEIGHT;
    const groundY = CONFIG.WORLD.GROUND_Y - 14; // 폭탄 반경 고려
    const y = (type === 'ground') ? groundY : rand(160, groundY - 120);
    const bomb = {
        type,
        x: CONFIG.CANVAS.WIDTH + 30,
        y,
        r: 14,
        vx: -baseSpeed * lerp(0.9, 1.35, Math.random()),
        fuse: rand(0, Math.PI * 2)
    };
    state.bombs.push(bomb);
}
function spawnCoin() {
    const y = rand(140, CONFIG.WORLD.GROUND_Y - 60);
    const coin = { x: CONFIG.CANVAS.WIDTH + 10, y, size: CONFIG.COIN.SIZE, vx: -CONFIG.BOMBS.BASE_SPEED * lerp(0.85, 1.1, Math.random()) };
    state.coinsList.push(coin);
}
function spawnItem() {
    const t = pick(CONFIG.ITEMS.TYPES);
    const y = rand(160, CONFIG.WORLD.GROUND_Y - 70);
    const item = { x: CONFIG.CANVAS.WIDTH + 12, y, w: 34, h: 22, vx: -CONFIG.BOMBS.BASE_SPEED * 0.9, type: t };
    state.items.push(item);
}

// 파티클(폭발)
function spawnExplosion(x, y) {
    for (let i = 0; i < 26; i++) {
        state.particles.push({
            x, y,
            vx: rand(-200, 200), vy: rand(-220, -20),
            life: rand(0.3, 0.65), age: 0,
            color: i % 2 ? '#ffb2b5' : '#ff5861'
        });
    }
}

// 충돌
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function circleRectOverlap(cx, cy, cr, rx, ry, rw, rh) {
    const nx = clamp(cx, rx, rx + rw);
    const ny = clamp(cy, ry, ry + rh);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= cr * cr;
}

// UI 표시
function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), CONFIG.UI.TOAST_MS);
}
const CHEERS = [
    '꾸준함이 곧 실력! 계속 가보자.',
    '오늘도 전진 중 👍',
    '네 페이스로 가면 돼.',
    '작은 한 걸음이 큰 변화를 만든다.'
];
function showCheer() {
    cheerEl.textContent = pick(CHEERS);
    cheerEl.classList.add('show');
    setTimeout(() => cheerEl.classList.remove('show'), CONFIG.UI.CHEER_MS);
}

// 메인 루프
function frame(ts) {
    if (!state.running) return;
    if (state.paused) { state.lastTs = ts; requestAnimationFrame(frame); return; }
    state.dt = Math.min(0.033, (ts - state.lastTs) / 1000);
    state.lastTs = ts;
    state.time += state.dt;
    state.spawn.elapsed += state.dt;
    state.survival += state.dt;
    update(state.dt);
    render();
    requestAnimationFrame(frame);
}

function update(dt) {
    const p = state.player;
    // 입력 적용
    p.vx = 0;
    if (state.inputs.left) { p.vx = -CONFIG.PLAYER.SPEED; p.facing = -1; }
    if (state.inputs.right) { p.vx = CONFIG.PLAYER.SPEED; p.facing = 1; }
    if (state.inputs.jump) { triggerJump(); state.inputs.jump = false; }

    // 물리
    p.vy += CONFIG.WORLD.GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // 바닥 충돌
    const groundTop = CONFIG.WORLD.GROUND_Y - CONFIG.PLAYER.HEIGHT;
    if (p.y >= groundTop) {
        p.y = groundTop; p.vy = 0; 
        if (!p.onGround) { p.jumpCount = 0; }
        p.onGround = true; 
        // 상태는 아래에서 일괄 결정
    }
    // 벽
    p.x = clamp(p.x, 10, CONFIG.CANVAS.WIDTH - CONFIG.PLAYER.WIDTH - 10);

    // 스폰 타이밍
    const e = state.spawn.elapsed;
    // 폭탄 스폰간격 감소
    const gCfg = CONFIG.BOMBS.GROUND_SPAWN;
    const aCfg = CONFIG.BOMBS.AIR_SPAWN;
    const coinCfg = CONFIG.COIN; const itemCfg = CONFIG.ITEMS;
    if (state.spawn.bombGround <= 0) {
        spawnBomb('ground');
        state.spawn.bombGround = Math.max(gCfg.MIN, gCfg.BASE - e * gCfg.RAMP) * lerp(0.8, 1.2, Math.random());
    } else state.spawn.bombGround -= dt;
    if (state.spawn.bombAir <= 0) {
        spawnBomb('air');
        state.spawn.bombAir = Math.max(aCfg.MIN, aCfg.BASE - e * aCfg.RAMP) * lerp(0.8, 1.2, Math.random());
    } else state.spawn.bombAir -= dt;
    if (state.spawn.coin <= 0) {
        spawnCoin();
        state.spawn.coin = Math.max(coinCfg.SPAWN_MIN, coinCfg.SPAWN_BASE - e * coinCfg.SPAWN_RAMP) * lerp(0.7, 1.3, Math.random());
    } else state.spawn.coin -= dt;
    if (state.spawn.item <= 0) {
        spawnItem();
        state.spawn.item = Math.max(itemCfg.SPAWN_MIN, itemCfg.SPAWN_BASE - e * itemCfg.SPAWN_RAMP) * lerp(0.9, 1.4, Math.random());
    } else state.spawn.item -= dt;

    // 엔티티 이동/제거
    state.bombs.forEach(b => { b.x += b.vx * dt; b.fuse += dt * 10; });
    state.coinsList.forEach(c => { c.x += c.vx * dt; });
    state.items.forEach(it => { it.x += it.vx * dt; });
    state.particles.forEach(pr => { pr.age += dt; pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.vy += 1200 * dt; });
    state.particles = state.particles.filter(pr => pr.age < pr.life);
    state.bombs = state.bombs.filter(b => b.x > -50);
    state.coinsList = state.coinsList.filter(c => c.x > -40);
    state.items = state.items.filter(i => i.x > -60);

    // 충돌: 코인
    for (let i = state.coinsList.length - 1; i >= 0; i--) {
        const c = state.coinsList[i];
        if (rectsOverlap(p.x, p.y, CONFIG.PLAYER.WIDTH, CONFIG.PLAYER.HEIGHT, c.x - c.size/2, c.y - c.size/2, c.size, c.size)) {
            state.coinsList.splice(i, 1);
            state.score += CONFIG.COIN.SCORE;
            state.coins += 1;
            audio.beep('coin');
            updateHUD();
            if (state.coins % 10 === 0) showCheer();
        }
    }

    // 충돌: 아이템(회복)
    for (let i = state.items.length - 1; i >= 0; i--) {
        const it = state.items[i];
        if (rectsOverlap(p.x, p.y, CONFIG.PLAYER.WIDTH, CONFIG.PLAYER.HEIGHT, it.x - it.w/2, it.y - it.h/2, it.w, it.h)) {
            state.items.splice(i, 1);
            const heal = it.type.heal;
            state.mental = clamp(state.mental + heal, 0, 100);
            updateHUD();
            audio.beep('item');
            showToast(`멘탈 +${heal}: ${it.type.label}!`);
            p.healTimer = 0.5; // 회복 연출
        }
    }

    // 충돌: 폭탄
    let minDist = Infinity;
    for (let i = state.bombs.length - 1; i >= 0; i--) {
        const b = state.bombs[i];
        const overlap = circleRectOverlap(b.x, b.y, b.r, p.x, p.y, CONFIG.PLAYER.WIDTH, CONFIG.PLAYER.HEIGHT);
        if (overlap) {
            // 직접 피격
            state.bombs.splice(i, 1);
            spawnExplosion(b.x, b.y);
            audio.beep('explode');
            applyMentalDamage(CONFIG.BOMBS.TOUCH_DAMAGE, false);
            p.hitTimer = 0.35; // 피격 연출
            p.state = 'hit';
            if (state.mental <= 0) { gameOver(); return; }
            continue;
        }
        // 근접도 계산
        const dx = (b.x) - (p.x + CONFIG.PLAYER.WIDTH/2);
        const dy = (b.y) - (p.y + CONFIG.PLAYER.HEIGHT/2);
        const d = Math.hypot(dx, dy);
        if (d < minDist) minDist = d;
    }
    // 근접 피해
    const r = CONFIG.BOMBS.NEAR_RADIUS;
    if (minDist < r) {
        state.nearDanger = true;
        const t = 1 - clamp(minDist / r, 0, 1);
        const dps = lerp(CONFIG.BOMBS.PROX_DAMAGE_MIN, CONFIG.BOMBS.PROX_DAMAGE_MAX, t);
        applyMentalDamage(dps * dt, true); // 근접 피해는 무음
        if (state.mental <= 0) { gameOver(); return; }
    } else {
        state.nearDanger = false;
    }
    canvasWrap.classList.toggle('danger', state.nearDanger);

    // 상태 결정 (피격 상태가 우선)
    if (p.hitTimer > 0) {
        p.hitTimer -= dt;
        p.state = 'hit';
    } else if (p.healTimer > 0) {
        p.healTimer -= dt;
        p.state = 'heal';
    } else {
        if (!p.onGround) p.state = 'jump';
        else if (Math.abs(p.vx) > 1) p.state = 'walk';
        else p.state = 'idle';
    }
}

function applyMentalDamage(amount, silent = false) {
    const prev = state.mental;
    state.mental = clamp(state.mental - amount, 0, 100);
    if (!silent && state.mental < prev) {
        audio.beep('hit');
    }
    if (state.mental !== prev) updateHUD();
}

// 렌더링
function render() {
    const W = CONFIG.CANVAS.WIDTH, H = CONFIG.CANVAS.HEIGHT;
    ctx.clearRect(0, 0, W, H);
    // 배경: 시청배경 이미지 (고화질 보간)
    if (bgReady && bgImage) {
        // cover 방식으로 채우기
        const iw = bgImage.width, ih = bgImage.height;
        const scale = Math.max(W / iw, H / ih);
        const dw = iw * scale, dh = ih * scale;
        const dx = (W - dw) / 2, dy = (H - dh) / 2;
        const prevSmooth = ctx.imageSmoothingEnabled;
        const prevQuality = ctx.imageSmoothingQuality;
        ctx.imageSmoothingEnabled = true;
        if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bgImage, dx, dy, dw, dh);
        // 픽셀아트는 선명하게 유지
        ctx.imageSmoothingEnabled = false;
        if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = prevQuality || 'low';
    } else {
        // 대체 그라디언트
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#0b1020');
        grad.addColorStop(1, '#0e1733');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    }
    // 지면(비표시): 물리적으로만 존재, 렌더링 생략

    // 코인
    for (const c of state.coinsList) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.fillStyle = '#ffd24a';
        ctx.beginPath();
        ctx.arc(0, 0, c.size/2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffef9b';
        ctx.fillRect(-2, -c.size/3, 4, (2*c.size)/3);
        ctx.restore();
    }

    // 아이템 (라벨 박스)
    for (const it of state.items) {
        ctx.save();
        ctx.translate(it.x, it.y);
        roundRect(ctx, -it.w/2, -it.h/2, it.w, it.h, 6);
        ctx.fillStyle = '#19375a'; ctx.fill();
        ctx.strokeStyle = '#79b6ff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#bfe1ff';
        ctx.font = 'bold 12px ui-sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(it.type.label, 0, 0);
        ctx.restore();
    }

    // 폭탄
    for (const b of state.bombs) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.fillStyle = '#0b0b0f';
        ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();
        // 신관/도화선
        ctx.strokeStyle = '#555a66'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -b.r + 2); ctx.lineTo(10, -b.r - 8); ctx.stroke();
        // 불꽃
        const flick = (Math.sin(b.fuse) + 1) * 0.5;
        ctx.fillStyle = flick > 0.5 ? '#ffea76' : '#ff8a4a';
        ctx.beginPath(); ctx.arc(12, -b.r - 10, 3 + flick * 2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    // 파티클
    for (const pr of state.particles) {
        ctx.fillStyle = pr.color;
        ctx.fillRect(pr.x, pr.y, 3, 3);
    }

    // 플레이어 (스프라이트 or 도트풍 대체)
    drawPlayer();
}

function drawPlayer() {
    const p = state.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (assetsReady) {
        p.frameTime += state.dt;
        let imageToDraw = images.idle1; // 기본
        if (p.state === 'walk') {
            const idx = Math.floor(p.frameTime / CONFIG.SPRITE.WALK_RATE) % 2;
            imageToDraw = idx === 0 ? images.walk1 : images.walk2;
        } else if (p.state === 'idle') {
            const idx = Math.floor(p.frameTime / CONFIG.SPRITE.IDLE_RATE) % 2;
            imageToDraw = idx === 0 ? images.idle1 : images.idle2;
        } else if (p.state === 'jump') {
            imageToDraw = images.jump;
        } else if (p.state === 'hit') {
            imageToDraw = images.hit;
        } else if (p.state === 'heal') {
            imageToDraw = images.heal;
        } else if (p.state === 'mentalout') {
            imageToDraw = images.mentalout;
        } else if (p.state === 'win') {
            imageToDraw = images.walk2;
        }
        if (p.facing === -1) { ctx.translate(CONFIG.PLAYER.WIDTH, 0); ctx.scale(-1, 1); }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(imageToDraw, 0, 0, CONFIG.PLAYER.WIDTH, CONFIG.PLAYER.HEIGHT);
    } else {
        // 대체 도형 렌더
        ctx.fillStyle = '#c0e2ff';
        ctx.fillRect(0, 0, CONFIG.PLAYER.WIDTH, CONFIG.PLAYER.HEIGHT);
        ctx.fillStyle = '#0a0f1a';
        ctx.fillRect(8, 10, 5, 5);
        ctx.fillRect(CONFIG.PLAYER.WIDTH - 13, 10, 5, 5);
    }
    // 그림자
    ctx.globalAlpha = 0.15; ctx.fillStyle = '#000';
    ctx.fillRect(-2, CONFIG.PLAYER.HEIGHT - 2, CONFIG.PLAYER.WIDTH + 4, 4);
    ctx.restore();
}

function roundRect(ctx2d, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx2d.beginPath();
    ctx2d.moveTo(x + rr, y);
    ctx2d.arcTo(x + w, y, x + w, y + h, rr);
    ctx2d.arcTo(x + w, y + h, x, y + h, rr);
    ctx2d.arcTo(x, y + h, x, y, rr);
    ctx2d.arcTo(x, y, x + w, y, rr);
    ctx2d.closePath();
}

// 게임오버
function gameOver() {
    state.running = false;
    const score = state.score;
    const coins = state.coins;
    const time = state.survival;
    // 멘탈아웃 연출 프레임 표시
    if (assetsReady) {
        state.player.state = 'mentalout';
        render();
    }
    finalScoreEl.textContent = String(score);
    finalCoinsEl.textContent = String(coins);
    finalTimeEl.textContent = time.toFixed(1) + 's';
    shareLineEl.textContent = `오늘의 드림 포인트: ${score} — 나 내일도 달린다!`;
    let isBest = false;
    if (score > state.best) { state.best = score; localStorage.setItem('dreamrun_best_score', String(score)); isBest = true; }
    newBestEl.hidden = !isBest;
    // 짧은 딜레이 후 오버레이 표시
    setTimeout(() => { gameOverOverlay.hidden = false; }, 200);
    startBtn.hidden = true;
    restartBtn.hidden = false;
}

// 초기화
setupInputs();
resetGame();
// 첫 화면 열기
openStart();



