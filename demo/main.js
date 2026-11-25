import '../dist/element.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const hero = document.getElementById('hero-ribbon');
const copy = document.querySelector('.copy');
let lastFade = -1;
hero.addEventListener('progress', (event) => {
  const fade = clamp01(event.detail / 0.3);
  if (Math.abs(fade - lastFade) < 1e-3) return;
  lastFade = fade;
  copy.style.opacity = (1 - fade).toFixed(3);
  copy.style.transform = `translate(${(-48 * fade).toFixed(1)}px, -50%)`;
  copy.style.pointerEvents = fade > 0.5 ? 'none' : '';
});

const preview = document.getElementById('preview');
const progress = document.getElementById('progress');
const form = document.getElementById('controls');
const output = document.getElementById('config');
const copyButton = document.getElementById('copy');
const field = (name) => form.elements.namedItem(name);
const num = (name) => Number(field(name).value);

const showValue = (input) => {
  const out = input.parentElement.querySelector('output');
  if (out) out.textContent = input.value;
};

const range = (name) => {
  let start = num(`${name}0`);
  let end = num(`${name}1`);
  if (end <= start) {
    end = Math.min(1, start + 0.01);
    start = Math.min(start, end - 0.01);
    field(`${name}0`).value = String(start);
    field(`${name}1`).value = String(end);
  }
  return [start, end];
};

function readOptions() {
  const glyphs = [];
  if (field('dot').checked) glyphs.push({ shape: 'dot', weight: 0.15 });
  for (const g of Array.from(field('glyphs').value)) if (g.trim()) glyphs.push(g);
  if (field('image').checked) glyphs.push({ image: './demo/mark.svg', weight: 0.05 });
  return {
    glyphs,
    maxGlyphs: num('maxGlyphs'),
    seed: Math.trunc(num('seed')) || 1,
    turns: num('turns'),
    speed: num('speed'),
    anchor: { x: num('anchorX'), y: num('anchorY') },
    timeline: { centre: range('centre'), zoom: range('zoom'), scatter: range('scatter') },
    motion: field('motion').value,
  };
}

let timer = 0;
function update() {
  const options = readOptions();
  for (const input of form.querySelectorAll('input[type="range"]')) showValue(input);
  output.textContent = JSON.stringify(options, null, 2);
  clearTimeout(timer);
  timer = setTimeout(() => {
    preview.options = { ...options, smoothing: 0, intro: false };
  }, 120);
}

form.addEventListener('input', update);
form.addEventListener('submit', (event) => event.preventDefault());
progress.addEventListener('input', () => {
  preview.progress = Number(progress.value);
  showValue(progress);
});

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.textContent);
    copyButton.textContent = 'Copied';
  } catch {
    copyButton.textContent = 'Copy failed';
  }
  setTimeout(() => (copyButton.textContent = 'Copy config'), 1500);
});

showValue(progress);
update();
