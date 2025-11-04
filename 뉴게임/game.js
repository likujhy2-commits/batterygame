// CONFIG: 모바일 우선 캔버스 게임 (똥피하기)
const CONFIG = {
    CANVAS: { WIDTH: 360, HEIGHT: 600 },
    PLAYER: { WIDTH: 32, HEIGHT: 36, SPEED: 320 },
    WORLD: { GROUND_Y: 560, GRAVITY: 0 },
    OBST: { SIZE_MIN: 18, SIZE_MAX: 34, SPEED_BASE: 160, SPEED_RAMP: 0.015, SPAWN_BASE: 0.9, SPAWN_MIN: 0.35, SPAWN_RAMP: 0.01 },
    INPUT: { POINTER_TOLERANCE: 24 },
};

// 유틸
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => Math.random() * (b - a) + a;

// DOM
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const scoreEl = document.getElementById('score');
const startOverlay = document.getElementById('startOverlay');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const startBtn = document.getElementById('startBtn');
const playAgainBtn = document.getElementById('playAgainBtn');
const restartBtn = document.getElementById('restartBtn');
const finalScoreEl = document.getElementById('finalScore');
const touchControls = document.getElementById('touchControls');
const btnLeft = document.getElementById('btnLeft');
const btnRight = document.getElementById('btnRight');

// DPR
function resizeCanvas() {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const W = CONFIG.CANVAS.WIDTH, H = CONFIG.CANVAS.HEIGHT;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// 상태
const state = {
    running: false,
    paused: false,
    time: 0,
    lastTs: 0,
    dt: 0,
    accum: 0,
    score: 0,
    survival: 0,
    player: null,
    inputs: { left: false, right: false },
    ob: [],
    spawn: { timer: 0, elapsed: 0 },
};

function reset() {
    state.running = false;
    state.paused = false;
    state.time = 0; state.lastTs = 0; state.dt = 0; state.accum = 0;
    state.score = 0; state.survival = 0;
    state.player = { x: CONFIG.CANVAS.WIDTH/2 - CONFIG.PLAYER.WIDTH/2, y: CONFIG.WORLD.GROUND_Y - CONFIG.PLAYER.HEIGHT, w: CONFIG.PLAYER.WIDTH, h: CONFIG.PLAYER.HEIGHT, vx: 0 };
    state.inputs = { left: false, right: false };
    state.ob = [];
    state.spawn = { timer: 0, elapsed: 0 };
    scoreEl.textContent = '0';
}

// 입력
function setupInputs() {
    window.addEventListener('keydown', (e) => {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') state.inputs.left = true;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') state.inputs.right = true;
    });
    window.addEventListener('keyup', (e) => {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') state.inputs.left = false;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') state.inputs.right = false;
    });
    // 터치 버튼
    const set = (key, on) => { state.inputs[key] = on; document.getElementById(key === 'left' ? 'btnLeft' : 'btnRight').classList.toggle('active', on); };
    if (btnLeft && btnRight) {
        btnLeft.addEventListener('pointerdown', (e) => { e.preventDefault(); set('left', true); btnLeft.setPointerCapture(e.pointerId); });
        btnLeft.addEventListener('pointerup', () => set('left', false));
        btnLeft.addEventListener('pointercancel', () => set('left', false));
        btnLeft.addEventListener('pointerleave', () => set('left', false));
        btnRight.addEventListener('pointerdown', (e) => { e.preventDefault(); set('right', true); btnRight.setPointerCapture(e.pointerId); });
        btnRight.addEventListener('pointerup', () => set('right', false));
        btnRight.addEventListener('pointercancel', () => set('right', false));
        btnRight.addEventListener('pointerleave', () => set('right', false));
    }
    // 화면 좌/우 절반 터치시 이동
    canvas.addEventListener('pointerdown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const leftHalf = x < rect.width / 2;
        if (leftHalf) { state.inputs.left = true; } else { state.inputs.right = true; }
    });
    canvas.addEventListener('pointerup', () => { state.inputs.left = false; state.inputs.right = false; });
    canvas.addEventListener('pointercancel', () => { state.inputs.left = false; state.inputs.right = false; });
}

// 스폰
function spawnObstacle() {
    const size = Math.round(rand(CONFIG.OBST.SIZE_MIN, CONFIG.OBST.SIZE_MAX));
    const x = Math.round(rand(6, CONFIG.CANVAS.WIDTH - size - 6));
    const y = -size - 4;
    const speed = CONFIG.OBST.SPEED_BASE * (1 + state.spawn.elapsed * CONFIG.OBST.SPEED_RAMP) * lerp(0.9, 1.2, Math.random());
    state.ob.push({ x, y, r: size/2, vy: speed });
}

function rectCircleOverlap(rx, ry, rw, rh, cx, cy, cr) {
    const nx = clamp(cx, rx, rx + rw);
    const ny = clamp(cy, ry, ry + rh);
    const dx = cx - nx, dy = cy - ny;
    return dx*dx + dy*dy <= cr*cr;
}

// 루프
function startGame() {
    if (state.running) return;
    startOverlay.hidden = true;
    gameOverOverlay.hidden = true;
    restartBtn.hidden = false;
    state.running = true;
    state.lastTs = performance.now();
    requestAnimationFrame(frame);
}

function gameOver() {
    state.running = false;
    finalScoreEl.textContent = String(state.score);
    setTimeout(() => { gameOverOverlay.hidden = false; }, 150);
}

function update(dt) {
    // 입력 -> 속도
    const p = state.player;
    p.vx = 0;
    if (state.inputs.left && !state.inputs.right) p.vx = -CONFIG.PLAYER.SPEED;
    else if (state.inputs.right && !state.inputs.left) p.vx = CONFIG.PLAYER.SPEED;
    p.x = clamp(p.x + p.vx * dt, 0, CONFIG.CANVAS.WIDTH - p.w);

    // 스폰 타이밍
    const e = state.spawn.elapsed;
    const next = Math.max(CONFIG.OBST.SPAWN_MIN, CONFIG.OBST.SPAWN_BASE - e * CONFIG.OBST.SPAWN_RAMP);
    if (state.spawn.timer <= 0) { spawnObstacle(); state.spawn.timer = next * lerp(0.85, 1.2, Math.random()); }
    else state.spawn.timer -= dt;
    state.spawn.elapsed += dt;

    // 장애물 이동/제거
    for (const o of state.ob) { o.y += o.vy * dt; }
    state.ob = state.ob.filter(o => o.y - o.r <= CONFIG.CANVAS.HEIGHT + 20);

    // 충돌
    for (const o of state.ob) {
        if (rectCircleOverlap(p.x, p.y, p.w, p.h, o.x + o.r, o.y + o.r, o.r)) {
            gameOver();
            return;
        }
    }

    // 점수: 생존 시간 기반
    state.survival += dt;
    state.score = Math.floor(state.survival * 10);
    scoreEl.textContent = String(state.score);
}

function render() {
    const W = CONFIG.CANVAS.WIDTH, H = CONFIG.CANVAS.HEIGHT;
    ctx.clearRect(0, 0, W, H);
    // 배경 그라디언트
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0b1020');
    grad.addColorStop(1, '#0e1733');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

    // 플레이어 (도트 스타일 캡슐)
    const p = state.player;
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.fillStyle = '#c0e2ff';
    roundRect(ctx, 0, 0, p.w, p.h, 8); ctx.fill();
    ctx.fillStyle = '#0a0f1a';
    ctx.fillRect(6, 10, 6, 6); // 눈
    ctx.fillRect(p.w - 12, 10, 6, 6);
    ctx.restore();

    // 장애물 (갈색 똥 모양: 원 2~3겹)
    for (const o of state.ob) {
        const cx = Math.round(o.x + o.r), cy = Math.round(o.y + o.r);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.fillStyle = '#7a4a24';
        ctx.beginPath(); ctx.arc(0, 6, o.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8d5a2d';
        ctx.beginPath(); ctx.arc(0, -2, o.r * 0.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9e6a36';
        ctx.beginPath(); ctx.arc(0, -10, o.r * 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
}

function frame(ts) {
    if (!state.running) return;
    const dt = Math.min(0.05, (ts - state.lastTs) / 1000);
    state.lastTs = ts;
    state.dt = dt;
    update(dt);
    render();
    requestAnimationFrame(frame);
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

// UI
startBtn.addEventListener('click', () => { reset(); startGame(); });
if (playAgainBtn) playAgainBtn.addEventListener('click', () => { reset(); startGame(); });
if (restartBtn) restartBtn.addEventListener('click', () => { reset(); startGame(); });

setupInputs();
reset();


