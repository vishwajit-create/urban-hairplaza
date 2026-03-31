/* Urban Hairplaza — Main JS */

// ── NAVBAR ──────────────────────────────────────────────
const navbar = document.getElementById('navbar');
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');

window.addEventListener('scroll', () => {
  if (window.scrollY > 20) navbar.classList.add('scrolled');
  else navbar.classList.remove('scrolled');
});

hamburger?.addEventListener('click', () => {
  hamburger.classList.toggle('open');
  mobileMenu.classList.toggle('open');
  document.body.style.overflow = mobileMenu.classList.contains('open') ? 'hidden' : '';
});

// Close mobile menu on link click
mobileMenu?.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => {
    hamburger.classList.remove('open');
    mobileMenu.classList.remove('open');
    document.body.style.overflow = '';
  });
});

// ── ACTIVE NAV LINK ─────────────────────────────────────
const currentPage = window.location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.nav-links a, #mobile-menu a').forEach(a => {
  if (a.getAttribute('href') === currentPage) a.classList.add('active');
});

// ── SCROLL REVEAL ────────────────────────────────────────
const reveals = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); } });
}, { threshold: 0.1 });
reveals.forEach(el => revealObserver.observe(el));

// ── LIGHTBOX (Gallery) ───────────────────────────────────
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');

document.querySelectorAll('.gallery-item img').forEach(img => {
  img.addEventListener('click', () => {
    if (!lightbox) return;
    lightboxImg.src = img.src;
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
});
lightboxClose?.addEventListener('click', closeLightbox);
lightbox?.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
function closeLightbox() {
  lightbox?.classList.remove('open');
  document.body.style.overflow = '';
}

// ── COUNTER ANIMATION (About page) ───────────────────────
function animateCounter(el, target, duration = 1500) {
  let start = 0;
  const step = (timestamp) => {
    if (!start) start = timestamp;
    const progress = Math.min((timestamp - start) / duration, 1);
    el.textContent = Math.floor(progress * target) + (el.dataset.suffix || '');
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const counters = document.querySelectorAll('[data-counter]');
if (counters.length) {
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        animateCounter(e.target, parseInt(e.target.dataset.counter), 1500);
        counterObserver.unobserve(e.target);
      }
    });
  }, { threshold: 0.5 });
  counters.forEach(c => counterObserver.observe(c));
}
