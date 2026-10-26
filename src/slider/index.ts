const q = new URLSearchParams(location.search);
const min = Number(q.get('min') ?? 0.2);
const max = Number(q.get('max') ?? 0.62);
const initial = Number(q.get('scale') ?? 0.44);

const range = document.getElementById('r') as HTMLInputElement;
const val = document.getElementById('val') as HTMLSpanElement;

range.min = String(min);
range.max = String(max);
range.step = '0.01';
range.value = String(initial);

const paint = () => {
  val.textContent = `${Math.round(Number(range.value) * 100)}%`;
};
paint();

range.addEventListener('input', () => {
  paint();
  window.pet.setScale(Number(range.value), false);
});
range.addEventListener('change', () => {
  window.pet.setScale(Number(range.value), true);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.pet.closeSlider();
});
window.addEventListener('blur', () => {
  window.pet.closeSlider();
});
