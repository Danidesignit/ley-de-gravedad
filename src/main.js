import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// ---------- Paleta (fría, de museo) ----------
const FOG_COLOR = 0x475868; // gris-azul frío
const FLOOR_COLOR = 0x414d57; // piso sutil, casi fundido con la niebla

// "Termómetro emocional": frío gris-azul en reposo, se entibia hacia
// ámbar/rosa polvo al acercarse al clímax, sin llegar nunca a un cálido
// pleno (MAX_WARMTH < 1), y drena de golpe al glitch.
const COLOR_COLD = new THREE.Color(FOG_COLOR);
const COLOR_WARM = new THREE.Color(0xb6735b); // mezcla ámbar (#A85C3A) / rosa polvo
const CENTRAL_TUBE_BASE_EMISSIVE = COLOR_WARM.clone().multiplyScalar(0.35); // brasa de reposo de los tubos
const MAX_WARMTH = 0.72;
const COLD_HOLD = 5; // segundos de frío puro al inicio antes de empezar a entibiar

// El central nunca queda en gris total: le queda un rastro de brasa
// (emissive, no el color de niebla) — muy por debajo del brillo pleno de
// los ajenos, para que el contraste siga siendo claro.
const CENTRAL_EMBER_FLOOR = 0.15; // brasa mínima, siempre presente, incluso en frío total
const CENTRAL_EMBER_MAX = 0.55; // apenas sube con el termómetro — sigue "apagado"
// Destello de caída: cada tubo suelta un último brillo al desprenderse,
// que se apaga mientras desciende — como una brasa enfriándose.
const FALL_GLOW_BOOST = 1.1;
const FALL_GLOW_DURATION = 0.8; // segundos hasta apagarse del todo

// Los instrumentos ajenos también quedaron a mitad de camino: ni cálidos
// ni completos, compañeros del mismo fracaso que el central, no versiones
// perfectas de un futuro que él no alcanzó. Sin aura, sin brillo pleno,
// estáticos — no pasan por ningún ciclo, ya están detenidos así.
const COLOR_ACHIEVED = new THREE.Color(0xc98a63);
const OTHERS_COUNT = 6; // copias incompletas alrededor, a distancia media
const OTHERS_EMISSIVE = 0.16; // brasa apagada y fija, no un brillo de logro
// Cada copia se arma a partir del mismo molde incompleto (faltan tubos,
// ver más abajo), así que no hace falta geometría distinta por instancia.
const CENTRAL_PARTICLE_COUNT = 26;
const CENTRAL_PARTICLE_MAX_OPACITY = 0.3; // tenue, nunca compite con los ajenos
const CENTRAL_PARTICLE_CLIMAX_START = 0.85; // fracción de MAX_WARMTH desde la que aparecen

// Polvo/ceniza ambiental: cubre todo el espacio, cae muy lento, gris y
// apagado — densidad en el aire, algo que se deshace despacio. Constante,
// no reacciona al termómetro (a propósito: no es luminoso ni cálido).
const AMBIENT_PARTICLE_COUNT = 260;
const AMBIENT_PARTICLE_COLOR = new THREE.Color(0x8f99a1);
const AMBIENT_PARTICLE_OPACITY = 0.2;
const AMBIENT_FALL_SPEED = 0.09; // unidades/s, cae casi imperceptible

function createGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ---------- Grieta en el suelo ----------
// Una fisura orgánica, discreta, cerca del instrumento central — la tierra
// no lo sostiene del todo. Rama recursiva con ancho decreciente, dibujada
// una sola vez en canvas (no hay assets externos).
function createCrackTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  function drawBranch(x0, y0, angle, length, width, depth) {
    if (depth <= 0 || width < 0.35) return;
    let x = x0;
    let y = y0;
    let a = angle;
    const segments = Math.max(4, Math.floor(length / 16));
    const points = [{ x, y }];
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i < segments; i++) {
      a += (Math.random() - 0.5) * 0.55;
      x += Math.cos(a) * (length / segments);
      y += Math.sin(a) * (length / segments);
      ctx.lineTo(x, y);
      points.push({ x, y });
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(8, 10, 13, 0.42)';
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(4, 5, 7, 0.3)';
    ctx.lineWidth = Math.max(0.6, width * 0.4);
    ctx.stroke();

    const branches = Math.random() < 0.65 ? 1 : 2;
    for (let b = 0; b < branches; b++) {
      const p = points[1 + Math.floor(Math.random() * (points.length - 2))];
      const branchAngle = a + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6);
      drawBranch(p.x, p.y, branchAngle, length * (0.32 + Math.random() * 0.22), width * 0.55, depth - 1);
    }
  }

  const cx = size / 2 + (Math.random() - 0.5) * 60;
  const cy = size / 2 + (Math.random() - 0.5) * 60;
  drawBranch(cx, cy, Math.random() * Math.PI * 2, size * 0.3, 3, 3);
  drawBranch(cx, cy, Math.random() * Math.PI * 2, size * 0.26, 2.4, 3);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------- Paleta atmosférica extendida ----------
// Niebla + cielo + luces transitan por una gama melancólica y desaturada —
// frío → rosa polvo → violeta tenue → ámbar apagado (clímax) → frío de
// nuevo. Nunca colores plenos ni festivos: "atardecer que ya pasó".
const ATMO_STOPS = [
  { t: 0, color: new THREE.Color(FOG_COLOR) }, // gris-azul frío
  { t: 0.35, color: new THREE.Color(0xa67986) }, // rosa polvo apagado
  { t: 0.68, color: new THREE.Color(0x847090) }, // violeta tenue
  { t: 1, color: new THREE.Color(0xb0885f) }, // ámbar apagado, nunca saturado
];
function sampleAtmosphere(t, out) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  for (let i = 0; i < ATMO_STOPS.length - 1; i++) {
    const a = ATMO_STOPS[i];
    const b = ATMO_STOPS[i + 1];
    if (t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t);
      return out.copy(a.color).lerp(b.color, localT);
    }
  }
  return out.copy(ATMO_STOPS[ATMO_STOPS.length - 1].color);
}

// ---------- Escena ----------
// Niebla exponencial (envolvente, más "densa" y natural que la lineal):
// el fondo se pinta del mismo color que la niebla para que no haya un
// horizonte visible — todo se disuelve en la bruma, no corta en seco.
const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.05); // densidad se ajusta tras cargar el modelo

// ---------- Cielo: insinuación de altura, no nubes ----------
// Un domo con gradiente muy sutil de piso a cenit, que se funde con la
// niebla en el color de base — le da profundidad al espacio sin recargarlo.
const skyMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uBottomColor: { value: new THREE.Color(FOG_COLOR) },
    uTopColor: { value: new THREE.Color(FOG_COLOR).multiplyScalar(0.78) },
  },
  vertexShader: `
    varying vec3 vWorldPosition;
    void main() {
      vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uBottomColor;
    uniform vec3 uTopColor;
    varying vec3 vWorldPosition;
    void main() {
      // A la altura de los ojos (y horizonte hacia abajo) queda el color
      // base exacto de la niebla, sin oscurecer — el degradado solo
      // aparece mirando hacia arriba.
      float h = clamp(normalize(vWorldPosition).y, 0.0, 1.0);
      gl_FragColor = vec4(mix(uBottomColor, uTopColor, pow(h, 1.6)), 1.0);
    }
  `,
  side: THREE.BackSide,
  fog: false,
  depthWrite: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(140, 24, 16), skyMaterial);
sky.renderOrder = -1;
scene.add(sky);

// ---------- Cámara (altura de ojos, se ajusta tras cargar el modelo) ----------
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.05,
  200
);
camera.position.set(0, 1.6, 8);

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// ---------- Post-procesamiento: distorsión del glitch ----------
// Aberración cromática + bandas de corrupción horizontal + ruido, todo
// controlado por un único uniform (uIntensity) que la app anima de golpe
// a 0 en el instante del glitch y decae rápido — "una señal que se rompe".
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const glitchPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uTime;
    varying vec2 vUv;

    float random(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;

      // Bandas de corrupción: franjas horizontales que se desplazan al azar
      float band = floor(uv.y * 45.0);
      float bandNoise = random(vec2(band, floor(uTime * 26.0)));
      float shift = (bandNoise - 0.5) * 0.05 * uIntensity * step(0.82, bandNoise);
      uv.x += shift;

      // Aberración cromática: cada canal muestreado con un offset distinto
      float aberration = 0.006 * uIntensity;
      float r = texture2D(tDiffuse, uv + vec2(aberration, 0.0)).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - vec2(aberration, 0.0)).b;
      vec3 color = vec3(r, g, b);

      // Ruido digital sutil
      float noise = (random(uv + uTime) - 0.5) * 0.12 * uIntensity;
      color += noise;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
composer.addPass(glitchPass);

// ---------- Controles en primera persona ----------
// Implementación propia (no PointerLockControls): esa clase mueve la cámara
// de forma instantánea en cada mousemove, sin ninguna opción de suavizado.
// Acá el mouse solo actualiza un "target" de yaw/pitch, y la cámara lo
// persigue con easing cada frame — fluido y contemplativo, no un giro seco.
let isLocked = false;
let yaw = 0;
let pitch = 0;
let targetYaw = 0;
let targetPitch = 0;
const PITCH_LIMIT = Math.PI / 2 - 0.02;
const LOOK_SENSITIVITY = 0.0022;
const LOOK_SMOOTHING = 14; // más alto = responde más rápido, más bajo = más suave
const MOVE_DAMPING = 5; // aceleración/frenado del caminar (antes 10 = brusco)
const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = new THREE.Vector3(); // reusado cada frame, no se crea uno nuevo

function moveForward(distance) {
  _forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _forward.y = 0;
  _forward.normalize();
  camera.position.addScaledVector(_forward, distance);
}
function moveRight(distance) {
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _right.y = 0;
  _right.normalize();
  camera.position.addScaledVector(_right, distance);
}

const blocker = document.getElementById('blocker');
const ctaLoadingPct = blocker.querySelector('.cta-loading-pct');

// ---------- Estado de carga ----------
// El modelo (~1.8MB) y el audio (~3.3MB) pueden tardar en conexiones
// lentas; mientras tanto el CTA queda inerte y avisa "cargando" en vez
// de dejar entrar a una escena sin el instrumento todavía armado. (El
// audio en sí se declara más abajo — acá solo quedan las funciones,
// que no lo necesitan hasta que se llaman.)
let pendingAssets = 2; // modelo + audio
function markAssetReady() {
  pendingAssets = Math.max(0, pendingAssets - 1);
  if (pendingAssets === 0) {
    blocker.classList.remove('is-loading');
  }
}
function markLoadError() {
  blocker.classList.remove('is-loading');
  blocker.classList.add('is-error');
}

document.addEventListener('pointerlockchange', () => {
  isLocked = document.pointerLockElement === document.body;
  if (isLocked) {
    blocker.classList.add('hidden');
  } else {
    blocker.classList.remove('hidden');
    // Reingreso tras haber empezado: la interfaz se muestra como pausa
    // (CTA de "continuar", sin el párrafo de contexto ya leído).
    blocker.classList.toggle('is-paused', audioStarted);
    // ESC = pausa de toda la obra (audio + animación), no solo el movimiento.
    if (audioStarted && !paused) {
      pauseCycle();
    }
  }
});
document.addEventListener('pointerlockerror', () => {
  console.error('No se pudo activar el control de mouse (pointer lock)');
});
document.addEventListener('mousemove', (e) => {
  if (!isLocked) return;
  targetYaw -= e.movementX * LOOK_SENSITIVITY;
  targetPitch -= e.movementY * LOOK_SENSITIVITY;
  targetPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, targetPitch));
});

blocker.addEventListener('click', () => {
  // Mientras carga (o si falló), el click no hace nada — nunca se entra
  // a una escena sin el instrumento todavía armado.
  if (blocker.classList.contains('is-loading') || blocker.classList.contains('is-error')) return;
  document.body.requestPointerLock();
  if (!audioStarted) {
    startCycle(); // primer click: además de entrar, arranca el ciclo audio + caída
  } else if (paused) {
    resumeCycle(); // reingreso tras ESC: se retoma donde quedó
  }
});

// Movimiento con WASD / flechas
const move = { forward: false, back: false, left: false, right: false };
const velocity = new THREE.Vector3();
let WALK_SPEED = 1.8; // se recalcula según la escala del modelo
let collisionRadius = 0; // cilindro de colisión alrededor del instrumento

function onKeyDown(e) {
  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp':
      move.forward = true;
      break;
    case 'KeyS':
    case 'ArrowDown':
      move.back = true;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      move.left = true;
      break;
    case 'KeyD':
    case 'ArrowRight':
      move.right = true;
      break;
  }
}
function onKeyUp(e) {
  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp':
      move.forward = false;
      break;
    case 'KeyS':
    case 'ArrowDown':
      move.back = false;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      move.left = false;
      break;
    case 'KeyD':
    case 'ArrowRight':
      move.right = false;
      break;
  }
}
document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

// ---------- Iluminación suave y atmosférica (museo, matte) ----------
// El cielo del hemisferio y la luz principal se entibian con el termómetro
// emocional; la luz de relleno y el suelo del hemisferio se mantienen fríos
// a propósito, para que nunca se sienta un cálido pleno.
const HEMI_SKY_COLD = new THREE.Color(0x6b7d8d);
const KEY_LIGHT_COLD = new THREE.Color(0xc4cdd6);
const KEY_LIGHT_BASE_INTENSITY = 1.35;

const hemi = new THREE.HemisphereLight(HEMI_SKY_COLD, 0x2a323b, 1.15);
scene.add(hemi);

const keyLight = new THREE.DirectionalLight(KEY_LIGHT_COLD, KEY_LIGHT_BASE_INTENSITY);
keyLight.position.set(5, 10, 4);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x5a6c7d, 0.55);
fillLight.position.set(-6, 4, -5);
scene.add(fillLight);

const ambient = new THREE.AmbientLight(0x475768, 0.5);
scene.add(ambient);

// ---------- Destellos con ritmo: un latido, no un pulso de fiesta ----------
// Luz dedicada, cálida y tenue, que modula su intensidad siguiendo un
// envolvente tipo "lub-dub" (dos golpes + pausa larga) cuyo tempo (BPM) y
// fuerza suben con el progreso del ciclo — un corazón acelerándose hacia
// el clímax, no un flash parejo tipo discoteca.
const PULSE_COLOR = 0xe8c9a8; // blanco cálido, nunca puro/estridente
const PULSE_BPM_MIN = 50; // reposo, casi imperceptible
const PULSE_BPM_MAX = 132; // clímax, ritmo ansioso
const PULSE_STRENGTH_MIN = 0.1;
const PULSE_STRENGTH_MAX = 0.95;
let pulsePhase = 0;

const pulseLight = new THREE.DirectionalLight(PULSE_COLOR, 0);
pulseLight.position.set(0, 10, 3);
scene.add(pulseLight);

function heartbeatEnvelope(phase01) {
  // phase01 en [0,1). "Lub" fuerte cerca del inicio, "dub" más chico poco
  // después, y una pausa larga hasta el próximo ciclo — orgánico, no una
  // onda pareja.
  const lub = Math.exp(-Math.pow((phase01 - 0.06) * 15, 2));
  const dub = Math.exp(-Math.pow((phase01 - 0.2) * 20, 2)) * 0.5;
  return Math.min(1, lub + dub);
}

// ---------- Luz desde abajo: santuario para los ajenos ----------
// Como monumentos consagrados en un museo — el central queda en penumbra
// en comparación, salvo un instante de gloria justo antes del glitch.
const UPLIGHT_COLOR = 0xd9a37c; // cálido de museo, no blanco puro
const CENTRAL_UPLIGHT_MAX_INTENSITY = 0.9;
let centralUplight = null; // se crea tras cargar el modelo

// ---------- Piso ----------
// Se dimensiona una vez que conocemos el tamaño real del modelo.
const floorMaterial = new THREE.MeshStandardMaterial({
  color: FLOOR_COLOR,
  roughness: 1,
  metalness: 0,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMaterial);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// ---------- Audio + ciclo (build-up → glitch → caída → silencio → loop) ----------
// El wav se editó (empalme en cruce por cero, sin clics): suena el build-up
// hasta ~35s y ahí salta directo al glitch (lo que antes eran los seg.
// 41.5-45 del audio original) — silencio real de por medio, eliminado. El
// punto de la unión es el instante exacto del glitch.
const GLITCH_TIME = 34.96; // segundos
// Pausa larga y contemplativa tras el desmoronamiento: el central queda en
// ruinas, los ajenos siguen brillando — tiempo para caminar y sentir el
// contraste antes de que la "compulsión a repetir" reinicie el ciclo solo.
const SILENCE_DURATION = 11; // segundos totales de calma antes de reiniciar
const RUINS_FADE_DURATION = 1.8; // últimos segundos: los tubos se hunden, no desaparecen de golpe
const AUDIO_FADE_IN = 1.6; // segundos de fundido de entrada al reiniciar el audio
const AUDIO_FADE_OUT_DELAY = 1.8; // segundos de margen tras asentarse, para que se termine de escuchar el glitch
const AUDIO_FADE_OUT = 1.3; // segundos: el audio se apaga junto con el desmoronamiento, ni cortado ni de más
const GRAVITY = 9.8; // unidades/s² — caída de construcción (rápida, "encaja")
// Desmoronamiento lento y largo, a propósito: más tiempo de caída y de
// ruina antes de que empiece la pausa contemplativa, para que la pérdida
// pese más.
const COLLAPSE_GRAVITY = 1.7; // muy lenta: cae de a poco, no se apura nada
const FLOOR_Y = 0.02;
const DROP_HEIGHT = 1.2; // altura desde la que cada tubo "cae" hasta encajar en su lugar
const BUILD_LEAD = 1.5; // segundos que el instrumento queda completo y tenso antes del glitch
const BUILD_DURATION = GLITCH_TIME - BUILD_LEAD; // ventana en la que se arma, uno a uno
const FALL_STAGGER_MAX = 4.2; // ventana de desfasaje al caer, mucho más ancha: el desmoronamiento se extiende bastante

// Fisher-Yates: un orden de caída realmente disperso, desacoplado de la
// posición espacial — si no, la física (los tubos más altos tardan más en
// llegar al piso) termina leyéndose como una secuencia por anillo/altura.
function shuffledIndices(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// El instante del glitch: un parpadeo violento pero triste, no de terror.
// El tiempo se traba un brevísimo instante, la cámara tiembla y la imagen
// se corrompe — los tres juntos, sincronizados exacto con el corte de audio.
const FREEZE_DURATION = 0.16; // segundos que "el tiempo se traba" antes de caer
const SHAKE_DURATION = 0.6; // segundos que tiembla la cámara
const GLITCH_FX_DURATION = 0.7; // segundos que dura la distorsión visual
// El desmoronamiento ahora es largo: un solo golpe de glitch al principio
// se sentía corto y el resto caía en silencio visual. Van varios pulsos
// más, repartidos a lo largo de la caída, cada vez que se cruza una
// fracción del total de tubos ya asentados — como si la corrupción
// volviera cada tanto, no un único estallido.
const GLITCH_PULSE_FRACTIONS = [0.22, 0.42, 0.62, 0.82];

const audio = new Audio('/futuro_que_nunca_llega.wav');
audio.preload = 'auto';
// Sin esto, el navegador corrige el tono al cambiar playbackRate (queda
// más rápido/lento pero con el mismo tono) — acá queremos lo contrario:
// que el desgaste entre ciclos también se oiga como un tono que decae.
audio.preservesPitch = false;
audio.mozPreservesPitch = false;
audio.webkitPreservesPitch = false;
if (audio.readyState >= 4) {
  markAssetReady(); // ya estaba en caché del navegador
} else {
  audio.addEventListener('canplaythrough', () => markAssetReady(), { once: true });
  audio.addEventListener('error', () => markLoadError(), { once: true });
}

// ---------- Desgaste entre intentos: la melodía en sí se ensucia ----------
// No alcanza con tocarla más lento: cada repetición fallida también la
// deja sonando más apagada y más rugosa, como un instrumento que se va
// desafinando de tanto intentarlo. Un filtro pasa-bajos progresivo (la
// va enmudeciendo, "cansada") y una distorsión suave (le agrega grano,
// "rugosa") se suman sobre el mismo audio, encadenados en Web Audio —
// procesamiento nativo del navegador, no cuesta nada en el frame.
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const audioSource = audioCtx.createMediaElementSource(audio);
const audioLowpass = audioCtx.createBiquadFilter();
audioLowpass.type = 'lowpass';
audioLowpass.frequency.value = 20000; // sin filtrar en el primer intento
const audioDistortion = audioCtx.createWaveShaper();
audioDistortion.oversample = '2x';
const audioMakeupGain = audioCtx.createGain();
audioMakeupGain.gain.value = 1;
audioSource.connect(audioLowpass);
audioLowpass.connect(audioDistortion);
audioDistortion.connect(audioMakeupGain);

// ---------- Análisis en vivo: los tubos del central laten con la música ----------
// Se engancha DESPUÉS del desgaste (pasa-bajos + distorsión), así el
// análisis "escucha" lo mismo que el oído — incluida la propia melodía
// enmudeciéndose en ciclos avanzados, que entonces también apaga solo la
// banda de agudos sin necesitar ningún caso especial.
const audioAnalyser = audioCtx.createAnalyser();
audioAnalyser.fftSize = 512;
audioAnalyser.smoothingTimeConstant = 0.78; // suaviza el parpadeo cuadro a cuadro
const audioFreqData = new Uint8Array(audioAnalyser.frequencyBinCount);
audioMakeupGain.connect(audioAnalyser);
audioAnalyser.connect(audioCtx.destination);

// Tres bandas simples (graves / medios / agudos), en bins de FFT — no hace
// falta más resolución para tres grupos de tubos.
const AUDIO_BAND_RANGES_HZ = [
  [20, 250],
  [250, 2000],
  [2000, 8000],
];
const audioBandBinRanges = AUDIO_BAND_RANGES_HZ.map(([lo, hi]) => {
  const hzPerBin = audioCtx.sampleRate / audioAnalyser.fftSize;
  return [Math.max(0, Math.floor(lo / hzPerBin)), Math.min(audioFreqData.length - 1, Math.ceil(hi / hzPerBin))];
});
function readBandEnergies() {
  audioAnalyser.getByteFrequencyData(audioFreqData);
  return audioBandBinRanges.map(([from, to]) => {
    let sum = 0;
    for (let i = from; i <= to; i++) sum += audioFreqData[i];
    return sum / (to - from + 1) / 255;
  });
}
// Acentos dentro de la misma familia melancólica que ya usa la obra (la
// gama rosa polvo → violeta → ámbar de ATMO_STOPS): graves = vino, medios
// = violeta, agudos = ámbar. Desaturados hacia el gris-azul de la niebla
// para que combinen con el entorno en vez de saltar como color puro.
const AUDIO_BAND_COLORS = [
  new THREE.Color(0xb44a5e).lerp(new THREE.Color(FOG_COLOR), 0.4),
  new THREE.Color(0x8a5ea3).lerp(new THREE.Color(FOG_COLOR), 0.4),
  new THREE.Color(0xd99a52).lerp(new THREE.Color(FOG_COLOR), 0.4),
];
const AUDIO_REACTIVE_INTENSITY_MAX = 0.42; // bajado bastante: se nota, no encandila
const AUDIO_COLOR_MIX_MAX = 0.5; // nunca llega al acento puro, se queda mezclado

// ---------- Audio espacial de los instrumentos ajenos: discos trabados ----------
// El central suena porque se está construyendo; los ajenos ya no están en
// construcción, quedaron detenidos en su fracaso. No deben sonar como una
// canción en progreso, sino como un disco trabado: un pedacito cortísimo
// de la melodía, justo hasta donde ese intento llegó, repitiéndose en
// loop sin avanzar nunca. Comparten el mismo AudioContext que la melodía
// principal, nada de un segundo contexto ni un segundo pedido de permiso.
THREE.AudioContext.setContext(audioCtx);
const listener = new THREE.AudioListener();
camera.add(listener);
const othersAudioLoader = new THREE.AudioLoader();
const othersSounds = []; // se llena al crear cada instrumento ajeno
let othersAudioBuffer = null;
let othersAmbiencePending = false;
othersAudioLoader.load('/futuro_que_nunca_llega.wav', (buffer) => {
  othersAudioBuffer = buffer;
  othersSounds.forEach((sound) => sound.setBuffer(buffer));
  if (othersAmbiencePending) startOthersAmbience();
});

// Recién arranca cuando el audio principal arranca (mismo gesto del
// usuario) y ya está decodificado el buffer — lo que termine último.
function startOthersAmbience() {
  if (!othersAudioBuffer) {
    othersAmbiencePending = true;
    return;
  }
  othersSounds.forEach((sound) => {
    if (!sound.isPlaying) sound.play();
  });
}
function pauseOthersAmbience() {
  othersSounds.forEach((sound) => {
    if (sound.isPlaying) sound.pause();
  });
}
function resumeOthersAmbience() {
  othersSounds.forEach((sound) => {
    if (sound.buffer && !sound.isPlaying) sound.play();
  });
}

// Curva de distorsión suave (soft-clipping): a mayor `amount`, más grano
// armónico sin llegar a puro ruido. amount = 0 deja la señal intacta.
function makeDistortionCurve(amount) {
  const samples = 2048;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = amount <= 0 ? x : ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// ---------- Ruido de glitch: el corte también se oye, no solo se ve ----------
// El desmoronamiento se alargó bastante y un único golpe de audio al
// principio se sentía corto. Cada pulso visual de glitch (el del inicio y
// los que se repiten durante la caída) dispara además un breve estallido
// de estática sintetizada — un ruido filtrado, no parte de la melodía —
// para que el oído acompañe la corrupción tanto como la vista.
const glitchNoiseBuffer = (() => {
  const length = Math.floor(audioCtx.sampleRate * 0.5);
  const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
})();

function playGlitchNoise() {
  const wear = Math.min(cycleCount, DEGRADATION_MAX_CYCLES) / DEGRADATION_MAX_CYCLES;
  const src = audioCtx.createBufferSource();
  src.buffer = glitchNoiseBuffer;

  const bandpass = audioCtx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 1300 + Math.random() * 2400; // distinto en cada pulso
  bandpass.Q.value = THREE.MathUtils.lerp(7, 3, wear); // más roto/ancho con el desgaste

  const envelope = audioCtx.createGain();
  const now = audioCtx.currentTime;
  const peak = THREE.MathUtils.lerp(0.4, 0.65, wear); // más fuerte a medida que se cansa
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(peak, now + 0.015); // ataque brusco
  envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.3); // decae rápido

  // Directo a destino, sin pasar por la cadena de desgaste de la melodía:
  // es una corrupción de la señal, no parte de la canción que se cansa.
  src.connect(bandpass);
  bandpass.connect(envelope);
  envelope.connect(audioCtx.destination);
  src.start(now);
  src.stop(now + 0.35);
}

// ---------- Cola del glitch: el corte real se estira, no solo se ve ----------
// El glitch que trae el propio audio (el corte editado a los 34.96s) dura
// apenas unos 3.5 segundos — muy corto para lo dramático que tiene que
// sentirse "se rompió todo". En vez de tocar el archivo, en el instante
// del glitch armamos una fuente aparte que retoma justo donde ese corte
// real termina y lo repite un par de veces más, con una reverb sintética
// liviana — el quiebre hace eco y se apaga solo, en vez de cortar seco.
// Usa el mismo buffer ya decodificado para el audio espacial de los
// ajenos: no hay una segunda descarga ni una segunda decodificación.
const GLITCH_SEGMENT_DURATION = 3.5; // segundos (41.5-45s del audio original)
const GLITCH_TAIL_REPEATS = 3; // veces que se repite el corte, además del real
function createReverbImpulse(ctx, duration = 2.2, decay = 3.2) {
  const length = Math.floor(ctx.sampleRate * duration);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}
const glitchTailReverb = audioCtx.createConvolver();
glitchTailReverb.buffer = createReverbImpulse(audioCtx);
glitchTailReverb.connect(audioCtx.destination);

function playGlitchTail() {
  if (!othersAudioBuffer) return; // buffer completo del tema, ya decodificado
  const src = audioCtx.createBufferSource();
  src.buffer = othersAudioBuffer;
  src.loop = true;
  src.loopStart = GLITCH_TIME;
  src.loopEnd = GLITCH_TIME + GLITCH_SEGMENT_DURATION;

  // Hereda el mismo nivel de desgaste del ciclo actual (el filtro de la
  // melodía principal ya lo tiene calculado) — también suena cansada.
  const tailLowpass = audioCtx.createBiquadFilter();
  tailLowpass.type = 'lowpass';
  tailLowpass.frequency.value = audioLowpass.frequency.value;

  const tailGain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  const startAt = now + GLITCH_SEGMENT_DURATION; // retoma justo donde termina el corte real
  const totalTailDuration = GLITCH_SEGMENT_DURATION * GLITCH_TAIL_REPEATS;
  tailGain.gain.setValueAtTime(0.5, startAt);
  tailGain.gain.setValueAtTime(0.5, startAt + totalTailDuration - 1.4);
  tailGain.gain.linearRampToValueAtTime(0, startAt + totalTailDuration); // se apaga solo, no de golpe

  src.connect(tailLowpass);
  tailLowpass.connect(tailGain);
  tailGain.connect(glitchTailReverb);
  src.start(startAt, GLITCH_TIME);
  src.stop(startAt + totalTailDuration + 0.1);
}

// ---------- Desgaste entre intentos ----------
// Cada vuelta del loop deja una marca: el audio se oye un poco más
// arrastrado/grave/apagado/rugoso, y el armado encaja con una imprecisión
// creciente — la acumulación silenciosa del fracaso. Se estabiliza en un
// techo (no crece para siempre) para que siga leyéndose como desgaste y
// no como ruptura. El techo se alcanza rápido (pocos ciclos) para que el
// cambio se note enseguida, no recién después de muchas repeticiones.
let cycleCount = 0;
const DEGRADATION_MAX_CYCLES = 6;
const AUDIO_MIN_PLAYBACK_RATE = 0.82;
const AUDIO_LOWPASS_START = 20000; // Hz, primer intento: sin enmudecer
const AUDIO_LOWPASS_END = 900; // Hz, techo del desgaste: apagada, "cansada"
const AUDIO_DISTORTION_MAX = 30; // grano/rugosidad en el techo del desgaste
const AUDIO_MAKEUP_GAIN_MAX = 1.3; // compensa el volumen que se pierde al enmudecer
const ASSEMBLY_JITTER_FRACTION_PER_CYCLE = 0.0058; // fracción de fogScale, por ciclo
const ASSEMBLY_ROT_JITTER_PER_CYCLE = 0.02; // radianes por ciclo
let assemblyJitterUnit = 0; // se fija tras conocer fogScale, al cargar el modelo

let cycleState = 'idle'; // idle | buildup | glitch | silence
let audioStarted = false;
let paused = false; // ESC = pausa de toda la obra (audio + animación)
let glitchTriggered = false;
let silenceTimer = 0;
let tubes = []; // se llena tras cargar el modelo
let warmth = 0; // 0 = frío, hasta MAX_WARMTH = punto más cálido posible
let centralEmberIntensity = CENTRAL_EMBER_FLOOR; // brasa base, la leen los tubos que caen
const warmableMaterials = []; // { material, baseColor } — mallas del instrumento
let othersMaterial = null; // material compartido de los instrumentos ajenos
let centralParticleMaterial = null;
let centralParticleGeometry = null;
let centralParticleBaseX = null;
let centralParticleBaseY = null;
let centralParticleBaseZ = null;
let centralParticleSeeds = null;
// Polvo ambiental: gris, apagado, sin brillo — distinto del aura luminosa
// de los ajenos. Cae lento y recicla (respawnea arriba), cubre todo el
// espacio, no solo alrededor de los instrumentos.
let ambientParticleGeometry = null;
let ambientParticleBaseX = null;
let ambientParticleBaseZ = null;
let ambientParticleSeeds = null;
let ambientTopY = 10;
let freezeTimer = 0;
let nextGlitchPulseIndex = 0; // próximo pulso de GLITCH_PULSE_FRACTIONS a disparar
let shakeTimer = Infinity; // Infinity = sin shake activo
let SHAKE_MAGNITUDE = 0.08; // se recalcula según la escala del modelo
const shakeOffset = new THREE.Vector3();
const lastShakeOffset = new THREE.Vector3();
let glitchFxIntensity = 0;

// Dispara los tres efectos juntos, en el instante exacto del glitch.
function triggerGlitchImpact() {
  shakeTimer = 0;
  glitchFxIntensity = 1;
  playGlitchNoise();
}

function startCycle() {
  if (audioStarted) return;
  audioStarted = true;
  // El AudioContext arranca "suspended" hasta el primer gesto del usuario
  // (política de autoplay del navegador) — este click ya es ese gesto.
  if (audioCtx.state === 'suspended') audioCtx.resume();
  cycleState = 'buildup';
  glitchTriggered = false;
  audio.currentTime = 0;
  audio.volume = 0; // fundido de entrada, no arranca de golpe
  audio.play().catch((err) => console.warn('No se pudo reproducir el audio', err));
  startOthersAmbience();
}

function pauseCycle() {
  paused = true;
  audio.pause();
  pauseOthersAmbience();
}

function resumeCycle() {
  paused = false;
  audio.play().catch(() => {});
  resumeOthersAmbience();
}

// Deja un tubo listo para la fase de construcción: oculto, en su posición
// final en X/Z pero levantado en Y, esperando su turno para "caer" y
// encajar. Se usa tanto al cargar el modelo como en cada reinicio del loop.
// `index` ordena el ARMADO (por anillo, de abajo hacia arriba — a propósito);
// `fallRank` ordena la CAÍDA, mezclado (Fisher-Yates), sin relación con la
// posición espacial, para que el desmoronamiento se vea disperso y caótico.
function armTubeForConstruction(t, index, total, fallRank) {
  const interval = BUILD_DURATION / total;
  const jitter = (Math.random() - 0.5) * interval * 0.8;
  t.assemblyTime = Math.min(Math.max(index * interval + jitter, 0), BUILD_DURATION);
  t.assembled = false;
  t.assembling = false;
  t.velocity.set(0, 0, 0);
  t.angularVelocity.set(0, 0, 0);
  t.mesh.visible = false;
  t.mesh.position.set(
    t.originalPosition.x,
    t.originalPosition.y + DROP_HEIGHT,
    t.originalPosition.z
  );
  t.mesh.quaternion.copy(t.originalQuaternion);
  const fallInterval = FALL_STAGGER_MAX / total;
  t.fallDelay = fallRank * fallInterval + Math.random() * fallInterval * 0.7;
  t.falling = false;
  t.settled = false;
  t.fallGlow = 0;
}

// El "encaje" de un tubo ya armado: en el primer intento queda perfecto,
// pero a partir de ahí lleva la marca del desgaste acumulado (ver
// ASSEMBLY_JITTER_*), siempre desviado hacia el mismo lado para ese tubo.
function settleTube(t) {
  const wear = Math.min(cycleCount, DEGRADATION_MAX_CYCLES);
  const posJitter = wear * assemblyJitterUnit;
  const rotJitter = wear * ASSEMBLY_ROT_JITTER_PER_CYCLE;
  t.mesh.position.copy(t.originalPosition).addScaledVector(t.jitterSeed, posJitter);
  t.mesh.quaternion.copy(t.originalQuaternion);
  if (rotJitter > 0) {
    t.mesh.rotateX(t.rotJitterSeed.x * rotJitter);
    t.mesh.rotateY(t.rotJitterSeed.y * rotJitter);
    t.mesh.rotateZ(t.rotJitterSeed.z * rotJitter);
  }
}

function resetCycle() {
  cycleCount++;
  // El instrumento suena cada vez más gastado, como una cinta que se
  // arrastra un poco más en cada repetición fallida: más lenta y grave
  // (playbackRate), más apagada (pasa-bajos) y más rugosa (distorsión).
  const wear = Math.min(cycleCount, DEGRADATION_MAX_CYCLES) / DEGRADATION_MAX_CYCLES;
  audio.playbackRate = THREE.MathUtils.lerp(1, AUDIO_MIN_PLAYBACK_RATE, wear);
  // Interpolación logarítmica (no lineal en Hz): el oído percibe los
  // graves de forma proporcional, así que bajar de 20000 a 10000 casi no
  // se nota, pero de 4000 a 2000 sí — con escala lineal el enmudecido
  // recién se notaba sobre el final. Así se nota ya desde el primer ciclo.
  audioLowpass.frequency.value = AUDIO_LOWPASS_START * Math.pow(AUDIO_LOWPASS_END / AUDIO_LOWPASS_START, wear);
  audioDistortion.curve = makeDistortionCurve(AUDIO_DISTORTION_MAX * wear);
  audioMakeupGain.gain.value = THREE.MathUtils.lerp(1, AUDIO_MAKEUP_GAIN_MAX, wear);
  const fallOrder = shuffledIndices(tubes.length);
  tubes.forEach((t, i) => armTubeForConstruction(t, i, tubes.length, fallOrder[i]));
  glitchTriggered = false;
  cycleState = 'buildup';
  audio.currentTime = 0;
  audio.volume = 0; // el nuevo intento resurge de a poco, no de golpe
  audio.play().catch(() => {});
}

// ---------- Carga del modelo ----------
const loader = new GLTFLoader();
loader.load(
  '/blender.glb',
  (gltf) => {
    const model = gltf.scene;

    // Estética matte: sin brillos especulares fuertes, nada sci-fi.
    // También guardamos el color base de cada material único, para poder
    // mezclarlo con el cálido del termómetro emocional más adelante.
    const seenMaterialIds = new Set();
    model.traverse((child) => {
      if (child.isMesh && child.material) {
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        materials.forEach((mat) => {
          if ('roughness' in mat) mat.roughness = Math.max(mat.roughness, 0.75);
          if ('metalness' in mat) mat.metalness = Math.min(mat.metalness, 0.15);
          mat.envMapIntensity = 0.3;
          if (mat.color && !seenMaterialIds.has(mat.uuid)) {
            seenMaterialIds.add(mat.uuid);
            // Brasa residual: un rastro tenue del cálido que nunca se apaga
            // del todo, para que el central se despegue de la niebla incluso
            // en frío total.
            if ('emissive' in mat) {
              mat.emissive = COLOR_WARM.clone().multiplyScalar(0.35);
              mat.emissiveIntensity = CENTRAL_EMBER_FLOOR;
            }
            warmableMaterials.push({ material: mat, baseColor: mat.color.clone() });
          }
        });
      }
    });

    scene.add(model);

    // Tamaño real del modelo, para centrar, escalar el piso y calcular
    // una altura de ojos "humana" que lo haga sentir imponente.
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y; // apoya el modelo sobre el piso (y = 0)
    model.updateMatrixWorld(true);

    const maxDim = Math.max(size.x, size.z);
    const height = size.y;

    // El instrumento debe verse grande e imponente: la altura de ojos
    // queda muy por debajo de la altura total del instrumento.
    const eyeHeight = Math.max(height * 0.09, 1.2);
    WALK_SPEED = eyeHeight * 1.1;
    collisionRadius = maxDim / 2 + 0.3;
    SHAKE_MAGNITUDE = eyeHeight * 0.05; // brusco pero sin marear

    // Punto de partida: fuera de la huella del instrumento, mirándolo.
    const startRadius = maxDim * 1.3;
    camera.position.set(0, eyeHeight, startRadius);
    camera.lookAt(0, height * 0.4, 0);
    // Sincronizamos el yaw/pitch suavizado con esta orientación inicial —
    // si no, el primer frame la resetearía a mirar de frente por defecto.
    lookEuler.setFromQuaternion(camera.quaternion);
    yaw = targetYaw = lookEuler.y;
    pitch = targetPitch = lookEuler.x;

    // Piso: bien más grande que el instrumento, sutil, se pierde en la niebla.
    const floorSize = Math.max(maxDim, height) * 12;
    floor.geometry.dispose();
    floor.geometry = new THREE.PlaneGeometry(floorSize, floorSize);

    // Densidad de la niebla en base a la escala real del instrumento: bien
    // densa — lo único que se tiene que ver con claridad es el central; los
    // ajenos, apenas una silueta parcial hasta que se camina hacia ellos.
    const fogScale = Math.max(maxDim, height);
    scene.fog.density = 0.83 / fogScale;
    assemblyJitterUnit = fogScale * ASSEMBLY_JITTER_FRACTION_PER_CYCLE;

    // ---- Grieta en el suelo, cerca del central ----
    // Discreta, no dramática: la tierra no lo sostiene del todo. Levemente
    // descentrada (no un mandala perfecto bajo el instrumento).
    const crackMaterial = new THREE.MeshStandardMaterial({
      map: createCrackTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 1,
      metalness: 0,
    });
    const crackSize = maxDim * 2.6;
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(crackSize, crackSize), crackMaterial);
    crack.rotation.x = -Math.PI / 2;
    crack.rotation.z = Math.random() * Math.PI * 2;
    crack.position.set(maxDim * 0.18, FLOOR_Y + 0.004, -maxDim * 0.22);
    scene.add(crack);

    // ---- Instrumentos ajenos: cada uno detenido en un punto distinto de
    // su propio fracaso ----. Ya no representan un futuro logrado: son
    // otros intentos que tampoco llegaron a completarse. Guardamos por
    // separado los aros (el molde, siempre entero) y los tubos, para
    // poder armar cada copia con una cantidad de tubos propia y distinta.
    // Como cada copia tiene su propia geometría, ya no pueden compartir
    // un único InstancedMesh — pero son solo OTHERS_COUNT mallas estáticas,
    // el costo extra de draw calls es insignificante.
    const otherRingGeometries = [];
    const otherTubeGeometries = [];
    model.traverse((child) => {
      if (!child.isMesh) return;
      const n = child.name.toLowerCase();
      const g = child.geometry.clone();
      g.applyMatrix4(child.matrixWorld);
      if (n.includes('tubo') || n.includes('cilindro')) {
        otherTubeGeometries.push(g);
      } else {
        otherRingGeometries.push(g);
      }
    });

    othersMaterial = new THREE.MeshStandardMaterial({
      color: COLOR_ACHIEVED,
      // Misma materialidad de aluminio sutil que el central, apenas
      // glossy — sigue siendo naranja, solo con un leve brillo.
      roughness: 0.55,
      metalness: 0.28,
      emissive: COLOR_ACHIEVED.clone().multiplyScalar(0.35),
      // Brasa fija, apagada, sin animar — ya no representan un logro,
      // así que no hace falta que reaccionen al ciclo del central.
      emissiveIntensity: OTHERS_EMISSIVE,
    });

    for (let i = 0; i < OTHERS_COUNT; i++) {
      const angle = (i / OTHERS_COUNT) * Math.PI * 2;
      // Lo bastante cerca como para intuirse desde el instrumento central
      // (una presencia etérea entre la niebla, no algo que haya que buscar
      // caminando a ciegas), y se aclaran de verdad al acercarse caminando.
      // Anillo parejo, equidistante — un arreglo organizado, no disperso.
      const dist = fogScale * 1.4;
      const cx = Math.cos(angle) * dist;
      const cz = Math.sin(angle) * dist;

      // Grado de incompletitud propio de esta copia: de "bastante armado,
      // sin llegar a terminar" a "casi nada" — con algo de variación
      // propia, no una gradiente prolija y regular.
      const t = OTHERS_COUNT > 1 ? i / (OTHERS_COUNT - 1) : 0;
      let completeness = THREE.MathUtils.lerp(0.82, 0.06, t) + (Math.random() - 0.5) * 0.1;
      completeness = THREE.MathUtils.clamp(completeness, 0.04, 0.9);
      const tubeOrder = shuffledIndices(otherTubeGeometries.length);
      const keepCount = Math.round(otherTubeGeometries.length * completeness);
      const keptTubes = tubeOrder.slice(0, keepCount).map((idx) => otherTubeGeometries[idx]);

      const instanceGeometry = mergeGeometries([...otherRingGeometries, ...keptTubes], false);
      const instanceMesh = new THREE.Mesh(instanceGeometry, othersMaterial);
      instanceMesh.position.set(cx, 0, cz);
      instanceMesh.rotation.y = Math.random() * Math.PI * 2;
      scene.add(instanceMesh);

      // Disco trabado: un recorte cortísimo del mismo tema, congelado en
      // el punto donde ESTE intento se frenó — cuanto más incompleta la
      // estructura, antes se cortó (recorte tomado más temprano en el
      // build-up), y más apagado/lento suena, la misma lógica de
      // deterioro que ya usa su geometría.
      const sound = new THREE.PositionalAudio(listener);
      sound.setLoop(true);
      sound.setVolume(THREE.MathUtils.lerp(0.12, 0.35, completeness));
      sound.setPlaybackRate(THREE.MathUtils.lerp(0.8, 0.96, completeness));
      // Rango corto a propósito: silencio desde el centro y entre ellos,
      // solo aparece al caminar bien cerca de este en particular.
      sound.setDistanceModel('linear');
      sound.setRefDistance(Math.max(maxDim * 0.4, 0.35));
      sound.setMaxDistance(maxDim * 1.3);
      sound.setRolloffFactor(1);
      const sonicLowpass = audioCtx.createBiquadFilter();
      sonicLowpass.type = 'lowpass';
      sonicLowpass.frequency.value = 450 * Math.pow(11, completeness); // ~500Hz a ~4400Hz
      sound.setFilter(sonicLowpass);
      // Recorte muy corto (menos de dos segundos): no se "escucha una
      // canción", suena a aguja trabada repitiendo el mismo instante.
      const fragmentSpan = THREE.MathUtils.lerp(0.85, 1.55, Math.random());
      const buildupUsable = Math.max(GLITCH_TIME - fragmentSpan - 1, fragmentSpan);
      // El punto de corte sigue el propio nivel de avance del instrumento:
      // el más incompleto se frenó casi al empezar, el más armado llegó
      // bastante más lejos antes de trabarse.
      const fragmentStart = THREE.MathUtils.clamp(
        completeness * buildupUsable + (Math.random() - 0.5) * 0.8,
        0,
        buildupUsable
      );
      sound.loopStart = fragmentStart;
      sound.loopEnd = fragmentStart + fragmentSpan;
      if (othersAudioBuffer) sound.setBuffer(othersAudioBuffer);
      instanceMesh.add(sound);
      othersSounds.push(sound);
    }
    otherRingGeometries.forEach((g) => g.dispose());
    otherTubeGeometries.forEach((g) => g.dispose());

    // El central sí recibe un único PointLight real, pero solo se enciende
    // brevemente en su instante de gloria (cerca del clímax) y vuelve a 0
    // el resto del tiempo — así el costo real es casi siempre nulo. Los
    // ajenos ya no tienen aura ni luz propia: apagados y quietos.
    centralUplight = new THREE.PointLight(UPLIGHT_COLOR, 0, height * 0.9, 2);
    centralUplight.position.set(0, height * 0.1, 0);
    scene.add(centralUplight);

    const glowTexture = createGlowTexture();

    // Central: pocas, chicas y tenues — casi invisibles salvo al borde del
    // clímax, y el drenaje de `warmth` en el glitch las apaga "de golpe".
    const centralPositions = new Float32Array(CENTRAL_PARTICLE_COUNT * 3);
    centralParticleBaseX = new Float32Array(CENTRAL_PARTICLE_COUNT);
    centralParticleBaseY = new Float32Array(CENTRAL_PARTICLE_COUNT);
    centralParticleBaseZ = new Float32Array(CENTRAL_PARTICLE_COUNT);
    centralParticleSeeds = new Float32Array(CENTRAL_PARTICLE_COUNT);
    const centralRadius = maxDim * 0.7;
    for (let i = 0; i < CENTRAL_PARTICLE_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * centralRadius;
      const y = Math.random() * height;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      centralPositions[i * 3] = x;
      centralPositions[i * 3 + 1] = y;
      centralPositions[i * 3 + 2] = z;
      centralParticleBaseX[i] = x;
      centralParticleBaseY[i] = y;
      centralParticleBaseZ[i] = z;
      centralParticleSeeds[i] = Math.random() * Math.PI * 2;
    }
    centralParticleGeometry = new THREE.BufferGeometry();
    centralParticleGeometry.setAttribute('position', new THREE.BufferAttribute(centralPositions, 3));
    centralParticleMaterial = new THREE.PointsMaterial({
      color: COLOR_WARM,
      size: fogScale * 0.014,
      map: glowTexture,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    scene.add(new THREE.Points(centralParticleGeometry, centralParticleMaterial));

    // Polvo/ceniza ambiental: cubre todo el espacio (no solo alrededor de
    // los instrumentos), cae lento y recicla — gris apagado, blending
    // normal (no aditivo), a propósito bien distinto del brillo cálido de
    // los ajenos. No reacciona al termómetro de color.
    ambientTopY = height * 1.35;
    const ambientRadius = fogScale * 5.5;
    const ambientPositions = new Float32Array(AMBIENT_PARTICLE_COUNT * 3);
    ambientParticleBaseX = new Float32Array(AMBIENT_PARTICLE_COUNT);
    ambientParticleBaseZ = new Float32Array(AMBIENT_PARTICLE_COUNT);
    ambientParticleSeeds = new Float32Array(AMBIENT_PARTICLE_COUNT);
    for (let i = 0; i < AMBIENT_PARTICLE_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * ambientRadius;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = Math.random() * ambientTopY;
      ambientPositions[i * 3] = x;
      ambientPositions[i * 3 + 1] = y;
      ambientPositions[i * 3 + 2] = z;
      ambientParticleBaseX[i] = x;
      ambientParticleBaseZ[i] = z;
      ambientParticleSeeds[i] = Math.random() * Math.PI * 2;
    }
    ambientParticleGeometry = new THREE.BufferGeometry();
    ambientParticleGeometry.setAttribute('position', new THREE.BufferAttribute(ambientPositions, 3));
    const ambientParticleMaterial = new THREE.PointsMaterial({
      color: AMBIENT_PARTICLE_COLOR,
      size: fogScale * 0.009,
      map: glowTexture,
      transparent: true,
      opacity: AMBIENT_PARTICLE_OPACITY,
      depthWrite: false,
      sizeAttenuation: true,
    });
    scene.add(new THREE.Points(ambientParticleGeometry, ambientParticleMaterial));

    // ---- Identificar tubos (Tubo_*) vs aros (Aro_*) ----
    // Reparentamos los tubos a la escena raíz (conservando su transform de
    // mundo) para poder animarlos en caída libre sin depender de la
    // jerarquía original del glb.
    const tubeMeshes = [];
    model.traverse((child) => {
      if (!child.isMesh) return;
      const n = child.name.toLowerCase();
      if (n.includes('tubo') || n.includes('cilindro')) {
        tubeMeshes.push(child);
      }
    });

    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    tubes = tubeMeshes.map((mesh, tubeIndex) => {
      mesh.getWorldPosition(worldPos);
      mesh.getWorldQuaternion(worldQuat);
      mesh.getWorldScale(worldScale);
      mesh.parent.remove(mesh);
      scene.add(mesh);
      mesh.position.copy(worldPos);
      mesh.quaternion.copy(worldQuat);
      mesh.scale.copy(worldScale);

      // Cada tubo con su propio material (clonado del compartido): así el
      // destello de caída de uno no enciende a los demás.
      mesh.material = mesh.material.clone();
      // Materialidad de aluminio, muy sutil — mismo color, apenas más
      // glossy que el resto (sin environment map, así que no hay reflejos
      // duros: solo un brillo leve donde pega la luz directa).
      mesh.material.roughness = 0.55;
      mesh.material.metalness = 0.3;
      warmableMaterials.push({ material: mesh.material, baseColor: mesh.material.color.clone() });

      return {
        mesh,
        originalPosition: worldPos.clone(),
        originalQuaternion: worldQuat.clone(),
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        fallDelay: 0,
        falling: false,
        settled: false,
        assemblyTime: 0,
        assembled: false,
        assembling: false,
        fallGlow: 0, // destello de "brasa" al desprenderse, se apaga cayendo
        // Dirección fija de imprecisión propia de este tubo: el desgaste
        // entre ciclos escala este mismo vector, así cada reintento se
        // desvía un poco más siempre para el mismo lado, no al azar cada vez.
        jitterSeed: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        rotJitterSeed: { x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 },
        // A qué banda de frecuencia responde este tubo (graves/medios/agudos).
        bandIndex: tubeIndex % AUDIO_BAND_COLORS.length,
      };
    });

    // El instrumento arranca vacío: los tubos quedan ocultos, en alto,
    // esperando su turno para caer y armar la estructura.
    const initialFallOrder = shuffledIndices(tubes.length);
    tubes.forEach((t, i) => armTubeForConstruction(t, i, tubes.length, initialFallOrder[i]));

    console.log('Modelo cargado:', model, {
      maxDim,
      height,
      eyeHeight,
      fogDensity: scene.fog.density,
      tubos: tubes.length,
    });
    if (ctaLoadingPct) ctaLoadingPct.textContent = '';
    markAssetReady();
  },
  (xhr) => {
    if (xhr.total) {
      const pct = Math.round((xhr.loaded / xhr.total) * 100);
      if (ctaLoadingPct) ctaLoadingPct.textContent = ` ${pct}%`;
    }
  },
  (error) => {
    console.error('Error cargando blender.glb', error);
    markLoadError();
  }
);

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Loop ----------
const clock = new THREE.Clock();

function updateCycle(delta) {
  if (cycleState === 'idle') return;

  if (cycleState === 'buildup') {
    // Fundido de entrada del audio: el intento resurge de a poco, no arranca
    // de golpe tras la pausa contemplativa.
    if (audio.volume < 1) {
      audio.volume = Math.min(1, audio.currentTime / AUDIO_FADE_IN);
    }

    // Construcción: cada tubo cae desde una pequeña altura y encaja en su
    // lugar, uno a uno, a medida que el audio crece — el instrumento se
    // arma en vivo, no empieza completo.
    tubes.forEach((t) => {
      if (t.assembled) return;

      if (!t.assembling) {
        if (audio.currentTime < t.assemblyTime) return;
        t.assembling = true;
        t.mesh.visible = true;
        t.velocity.set(0, 0, 0);
      }

      t.velocity.y -= GRAVITY * delta;
      t.mesh.position.y += t.velocity.y * delta;

      if (t.mesh.position.y <= t.originalPosition.y) {
        settleTube(t);
        t.assembled = true;
        t.assembling = false;
        t.velocity.set(0, 0, 0);
      }
    });

    if (!glitchTriggered && audio.currentTime >= GLITCH_TIME) {
      // Por seguridad, si algún tubo quedó a mitad de camino, lo encajamos
      // igual: el glitch siempre parte del instrumento entero.
      tubes.forEach((t) => {
        if (t.assembled) return;
        t.mesh.visible = true;
        settleTube(t);
        t.assembled = true;
        t.assembling = false;
      });

      glitchTriggered = true;
      cycleState = 'freeze';
      freezeTimer = 0;
      nextGlitchPulseIndex = 0;
      triggerGlitchImpact(); // shake + distorsión visual, en el mismo instante
      playGlitchTail(); // estira el corte real del audio con eco + reverb
      console.log('Glitch — el tiempo se traba');
    }
    return;
  }

  if (cycleState === 'freeze') {
    // Un brevísimo instante en el que nada se mueve, justo antes de caer.
    freezeTimer += delta;
    if (freezeTimer >= FREEZE_DURATION) {
      cycleState = 'glitch';
      console.log('Glitch — los tubos se desprenden');
    }
    return;
  }

  if (cycleState === 'glitch') {
    let allSettled = tubes.length > 0;
    let settledCount = 0;
    tubes.forEach((t) => {
      // La brasa sigue enfriándose incluso después de aterrizar.
      if (t.fallGlow > 0) t.fallGlow = Math.max(0, t.fallGlow - delta / FALL_GLOW_DURATION);

      if (t.settled) {
        settledCount++;
        return;
      }
      allSettled = false;

      if (!t.falling) {
        t.fallDelay -= delta;
        if (t.fallDelay > 0) return;
        t.falling = true;
        t.fallGlow = 1; // último destello al desprenderse
        t.velocity.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
        t.angularVelocity.set(
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4
        );
      }

      t.velocity.y -= COLLAPSE_GRAVITY * delta;
      t.mesh.position.addScaledVector(t.velocity, delta);
      t.mesh.rotation.x += t.angularVelocity.x * delta;
      t.mesh.rotation.y += t.angularVelocity.y * delta;
      t.mesh.rotation.z += t.angularVelocity.z * delta;

      if (t.mesh.position.y <= FLOOR_Y) {
        t.mesh.position.y = FLOOR_Y;
        t.settled = true;
        settledCount++;
      }
    });

    // Varios pulsos de glitch repartidos a lo largo de la caída (no solo
    // el del principio): la corrupción vuelve cada tanto mientras el
    // instrumento se sigue desmoronando.
    const settledFraction = tubes.length > 0 ? settledCount / tubes.length : 0;
    while (
      nextGlitchPulseIndex < GLITCH_PULSE_FRACTIONS.length &&
      settledFraction >= GLITCH_PULSE_FRACTIONS[nextGlitchPulseIndex]
    ) {
      triggerGlitchImpact();
      nextGlitchPulseIndex++;
    }

    if (allSettled) {
      cycleState = 'silence';
      silenceTimer = 0;
      // El audio no se corta en seco: se deja terminar el eco del glitch y
      // recién ahí se apaga con un fundido breve (ver más abajo) — ni
      // cortado a mitad de sonido, ni sonando de más sobre el instrumento
      // ya quieto.
    }
    return;
  }

  if (cycleState === 'silence') {
    silenceTimer += delta;

    // Fundido de salida del audio: un margen tras asentarse para que el
    // glitch/corte se termine de escuchar bien (no cortarlo a mitad de
    // sonido), y recién ahí un fundido breve — nunca sonando de más sobre
    // las ruinas ya del todo quietas.
    if (silenceTimer >= AUDIO_FADE_OUT_DELAY) {
      const fadeElapsed = silenceTimer - AUDIO_FADE_OUT_DELAY;
      if (fadeElapsed < AUDIO_FADE_OUT) {
        audio.volume = Math.max(0, 1 - fadeElapsed / AUDIO_FADE_OUT);
      } else if (!audio.paused) {
        audio.pause();
      }
    }

    // Sobre el final de la pausa, las ruinas se hunden lentamente bajo el
    // piso (no desaparecen de golpe) — para cuando el ciclo reinicia, ya
    // se disolvieron en la niebla, sin corte brusco.
    const fadeStart = SILENCE_DURATION - RUINS_FADE_DURATION;
    if (silenceTimer >= fadeStart) {
      const fadeT = Math.min(1, (silenceTimer - fadeStart) / RUINS_FADE_DURATION);
      const sinkEase = fadeT * fadeT; // arranca lento, se hunde más rápido al final
      tubes.forEach((t) => {
        t.mesh.position.y = FLOOR_Y - sinkEase * 1.5;
      });
    }

    if (silenceTimer >= SILENCE_DURATION) {
      resetCycle();
    }
  }
}

// ---------- Termómetro emocional de color ----------
// Frío en reposo → se entibia hacia ámbar/rosa polvo a medida que el
// instrumento se arma y la canción sube hacia el clímax (progreso =
// audio.currentTime / GLITCH_TIME) → drena de golpe al glitch/colapso.
const tmpColor = new THREE.Color();

function updateColorTemperature(delta) {
  let target = 0; // glitch / silencio / idle: frío
  if (cycleState === 'buildup' && audio.currentTime > COLD_HOLD) {
    const progress = THREE.MathUtils.clamp(
      (audio.currentTime - COLD_HOLD) / (GLITCH_TIME - COLD_HOLD),
      0,
      1
    );
    target = progress * MAX_WARMTH;
  }

  // Subida suave y progresiva; bajada rápida ("de golpe") en el glitch.
  const speed = target > warmth ? 2.2 : 6;
  warmth += (target - warmth) * Math.min(1, speed * delta);
  if (Math.abs(target - warmth) < 0.001) warmth = target;

  // Progreso normalizado del ciclo (0 = frío pleno, 1 = clímax) — se usa
  // para todo lo que "sigue" al termómetro: niebla/cielo/luces, la brasa
  // residual del central y el revelado de los ajenos.
  const cycleT = MAX_WARMTH > 0 ? warmth / MAX_WARMTH : 0;

  // Destellos con ritmo: el tempo (BPM) y la fuerza del latido suben con
  // el progreso del ciclo — late más rápido y más fuerte hacia el clímax,
  // como un corazón acelerándose. Fase acumulada en el tiempo (no un
  // simple seno reparametrizado), así el cambio de tempo es continuo.
  const pulseBpm = THREE.MathUtils.lerp(PULSE_BPM_MIN, PULSE_BPM_MAX, cycleT);
  pulsePhase = (pulsePhase + (pulseBpm / 60) * delta) % 1;
  const pulseStrength = THREE.MathUtils.lerp(PULSE_STRENGTH_MIN, PULSE_STRENGTH_MAX, cycleT);
  pulseLight.intensity = heartbeatEnvelope(pulsePhase) * pulseStrength;

  // El central recibe su instante de gloria (luz desde abajo) solo al
  // borde del clímax, y se apaga de golpe con el resto en el glitch.
  if (centralUplight) {
    const glowT = THREE.MathUtils.smoothstep(warmth, MAX_WARMTH * CENTRAL_PARTICLE_CLIMAX_START, MAX_WARMTH);
    centralUplight.intensity = glowT * CENTRAL_UPLIGHT_MAX_INTENSITY;
  }

  // Paleta atmosférica: frío → rosa polvo → violeta tenue → ámbar apagado
  // (clímax) → frío de nuevo. Niebla, cielo y luces comparten esta muestra.
  sampleAtmosphere(cycleT, tmpColor);
  scene.fog.color.copy(tmpColor);
  scene.background.copy(tmpColor);
  skyMaterial.uniforms.uBottomColor.value.copy(tmpColor);
  skyMaterial.uniforms.uTopColor.value.copy(tmpColor).multiplyScalar(0.78);

  // Hacia el clímax, el central se va tiñendo del mismo naranja que ya
  // lograron los de alrededor (COLOR_ACHIEVED) — no un ámbar propio — y
  // vuelve de golpe a su color base apenas cae `warmth` (glitch/colapso).
  warmableMaterials.forEach(({ material, baseColor }) => {
    material.color.copy(baseColor).lerp(COLOR_ACHIEVED, cycleT);
  });

  // Brasa residual: nunca queda en gris total, aunque esté en frío pleno —
  // el recuerdo del calor que casi tuvo. Sube apenas con el termómetro.
  centralEmberIntensity = THREE.MathUtils.lerp(CENTRAL_EMBER_FLOOR, CENTRAL_EMBER_MAX, cycleT);
  warmableMaterials.forEach(({ material }) => {
    if ('emissiveIntensity' in material) material.emissiveIntensity = centralEmberIntensity;
  });
  // Encima de esa base, dos capas más por tubo — cada uno con su propio
  // material clonado, así no se contagian entre sí:
  // 1) el destello de los que se están cayendo, y
  // 2) el pulso de color que sigue a la música: cada tubo "escucha" una
  //    banda de frecuencia distinta (ver bandIndex) y se enciende con el
  //    acento de esa banda cuando suena fuerte — crece con el build-up
  //    (cycleT) y se corta solo en el glitch, porque cycleT cae de golpe.
  const audioBandEnergies = readBandEnergies();
  tubes.forEach((t) => {
    const mat = t.mesh.material;
    if (!('emissiveIntensity' in mat)) return;
    const reactiveT = audioBandEnergies[t.bandIndex] * cycleT;
    mat.emissive.copy(CENTRAL_TUBE_BASE_EMISSIVE).lerp(AUDIO_BAND_COLORS[t.bandIndex], reactiveT * AUDIO_COLOR_MIX_MAX);
    const fallBoost = t.fallGlow > 0 ? t.fallGlow * FALL_GLOW_BOOST : 0;
    mat.emissiveIntensity = centralEmberIntensity + fallBoost + reactiveT * AUDIO_REACTIVE_INTENSITY_MAX;
  });

  // Las luces siguen la misma paleta atmosférica, más sutilmente — la luz
  // de relleno y el suelo del hemisferio quedan fríos siempre, para que
  // nunca sea un cálido pleno.
  const lightWarmth = warmth * 0.55;
  hemi.color.copy(HEMI_SKY_COLD).lerp(tmpColor, lightWarmth);
  keyLight.color.copy(KEY_LIGHT_COLD).lerp(tmpColor, lightWarmth);

  // Los ajenos ya no reaccionan al ciclo del central: quedaron detenidos,
  // a medio camino, con su brasa apagada fija (ver creación de othersMaterial).

  // El central casi nunca tiene partículas: solo asoman un puñado tenue
  // justo al borde del clímax, y se apagan de golpe apenas cae `warmth`.
  if (centralParticleMaterial) {
    const climaxT = THREE.MathUtils.smoothstep(warmth, MAX_WARMTH * CENTRAL_PARTICLE_CLIMAX_START, MAX_WARMTH);
    centralParticleMaterial.opacity = climaxT * CENTRAL_PARTICLE_MAX_OPACITY;
  }
}

// Deriva tipo "polvo flotando" en X/Y/Z — cada eje con su propia fase para
// que no se sienta un movimiento circular perfecto. Barato: solo mueve las
// posiciones ya guardadas, sin importar cuántos cientos de partículas haya.
function updateParticles(time) {
  if (centralParticleGeometry) {
    const pos = centralParticleGeometry.attributes.position.array;
    for (let i = 0; i < centralParticleBaseY.length; i++) {
      const seed = centralParticleSeeds[i];
      pos[i * 3] = centralParticleBaseX[i] + Math.sin(time * 0.45 + seed) * 0.14;
      pos[i * 3 + 1] = centralParticleBaseY[i] + Math.sin(time * 0.7 + seed * 1.7) * 0.26;
      pos[i * 3 + 2] = centralParticleBaseZ[i] + Math.cos(time * 0.4 + seed * 1.3) * 0.14;
    }
    centralParticleGeometry.attributes.position.needsUpdate = true;
  }
}

// Polvo/ceniza ambiental: cae despacio y recicla arriba al llegar al piso,
// con una leve deriva horizontal — cubre todo el espacio, no solo alrededor
// de los instrumentos. Nunca cambia de color ni brilla.
function updateAmbientDust(delta, time) {
  if (!ambientParticleGeometry) return;
  const pos = ambientParticleGeometry.attributes.position.array;
  for (let i = 0; i < ambientParticleBaseX.length; i++) {
    let y = pos[i * 3 + 1] - AMBIENT_FALL_SPEED * delta;
    if (y < FLOOR_Y) y = ambientTopY;
    pos[i * 3 + 1] = y;
    const seed = ambientParticleSeeds[i];
    pos[i * 3] = ambientParticleBaseX[i] + Math.sin(time * 0.15 + seed) * 0.4;
    pos[i * 3 + 2] = ambientParticleBaseZ[i] + Math.cos(time * 0.12 + seed * 1.3) * 0.4;
  }
  ambientParticleGeometry.attributes.position.needsUpdate = true;
}

// Shake de cámara (violento y breve, decae rápido) + intensidad de la
// distorsión visual del glitch (se anima a 0 con el tiempo). Se aplica como
// un offset reversible sobre camera.position, para no interferir con el
// movimiento normal ni con PointerLockControls.
function updateGlitchEffects(delta) {
  if (shakeTimer < SHAKE_DURATION) {
    shakeTimer += delta;
    const t = Math.min(shakeTimer / SHAKE_DURATION, 1);
    const envelope = (1 - t) * (1 - t); // arranca brusco, decae rápido a la calma
    shakeOffset.set(
      (Math.random() - 0.5) * 2 * SHAKE_MAGNITUDE * envelope,
      (Math.random() - 0.5) * 2 * SHAKE_MAGNITUDE * envelope,
      (Math.random() - 0.5) * 2 * SHAKE_MAGNITUDE * envelope
    );
    camera.position.sub(lastShakeOffset).add(shakeOffset);
    lastShakeOffset.copy(shakeOffset);
  } else if (lastShakeOffset.lengthSq() > 0) {
    camera.position.sub(lastShakeOffset);
    lastShakeOffset.set(0, 0, 0);
  }

  if (glitchFxIntensity > 0) {
    glitchFxIntensity = Math.max(0, glitchFxIntensity - delta / GLITCH_FX_DURATION);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  // Giro del mouse con easing: la cámara persigue el target, no salta con
  // cada movimiento — se corre siempre, así se asienta suave aunque el
  // puntero se suelte a mitad de un giro.
  yaw += (targetYaw - yaw) * Math.min(1, LOOK_SMOOTHING * delta);
  pitch += (targetPitch - pitch) * Math.min(1, LOOK_SMOOTHING * delta);
  camera.quaternion.setFromEuler(lookEuler.set(pitch, yaw, 0, 'YXZ'));

  if (isLocked && cycleState !== 'freeze') {
    velocity.x -= velocity.x * MOVE_DAMPING * delta;
    velocity.z -= velocity.z * MOVE_DAMPING * delta;

    const dir = _moveDir.set(
      Number(move.right) - Number(move.left),
      0,
      Number(move.forward) - Number(move.back)
    );
    if (dir.lengthSq() > 0) dir.normalize();

    velocity.x -= dir.x * WALK_SPEED * MOVE_DAMPING * delta;
    velocity.z -= dir.z * WALK_SPEED * MOVE_DAMPING * delta;

    moveRight(-velocity.x * delta);
    moveForward(-velocity.z * delta);

    // Colisión simple: no se puede atravesar el instrumento (cilindro invisible)
    if (collisionRadius > 0) {
      const dist = Math.hypot(camera.position.x, camera.position.z);
      if (dist < collisionRadius) {
        const scale = collisionRadius / dist;
        camera.position.x *= scale;
        camera.position.z *= scale;
      }
    }
  }

  if (!paused) {
    updateCycle(delta);
    updateColorTemperature(delta);
    updateParticles(clock.elapsedTime);
    updateAmbientDust(delta, clock.elapsedTime);
    updateGlitchEffects(delta);
  }

  glitchPass.uniforms.uIntensity.value = glitchFxIntensity;
  glitchPass.uniforms.uTime.value = clock.elapsedTime;
  composer.render();
}
animate();
