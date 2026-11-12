/* Beauty Parlour – Main JS */

// --- NAVBAR SCROLL ---
const navbar = document.querySelector('.navbar');
if (navbar) {
  window.addEventListener('scroll', () => {
    if (window.scrollY > 10) navbar.style.boxShadow = '0 2px 12px rgba(26,10,7,0.08)';
    else navbar.style.boxShadow = '';
  });
}

// --- HAMBURGER MENU ---
const hamburger = document.getElementById('hamburger');
const drawer = document.getElementById('mobile-drawer');

hamburger?.addEventListener('click', () => {
  hamburger.classList.toggle('open');
  drawer?.classList.toggle('open');
  document.body.style.overflow = drawer?.classList.contains('open') ? 'hidden' : '';
});

// Close drawer on nav link click
drawer?.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => {
    hamburger?.classList.remove('open');
    drawer.classList.remove('open');
    document.body.style.overflow = '';
  });
});

// --- ACTIVE NAV LINK ---
const currentPage = window.location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.nav-links .nav-link, .mobile-drawer .nav-link').forEach(a => {
  if (a.getAttribute('href') === currentPage) {
    a.classList.add('active');
  }
});

// --- SCROLL REVEAL ---
const reveals = document.querySelectorAll('.service-card, .why-card, .gallery-card, .price-row, .gallery-item, .info-item, .contact-info-card');
if (reveals.length > 0) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });

  reveals.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(16px)';
    el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    observer.observe(el);
  });
}

// --- GALLERY FILTER (gallery.html) ---
function initGalleryFilter() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  const cards = document.querySelectorAll('.gallery-card');
  if (!filterBtns.length) return;

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      cards.forEach(card => {
        if (filter === 'all' || card.dataset.category === filter) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });
}

// --- CONTACT FORM (contact.html) ---
function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const success = document.getElementById('form-success');
    const name = form.querySelector('[name="name"]').value.trim();
    const phone = form.querySelector('[name="phone"]').value.trim();
    const service = form.querySelector('[name="service"]')?.value || 'General';
    const message = form.querySelector('[name="message"]').value.trim();

    if (!name || !phone || !message) {
      alert('Please fill in Name, Phone, and Message.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
      const res = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, phone,
          email: form.querySelector('[name="email"]')?.value || '',
          subject: `Beauty Parlour – ${service}`,
          message
        })
      });

      if (res.ok) {
        form.reset();
        if (success) { success.style.display = 'block'; }
        btn.textContent = 'Message Sent!';
      } else {
        btn.textContent = 'Send Message';
        btn.disabled = false;
        alert('Could not send message. Please call us directly.');
      }
    } catch {
      // If backend not running, show WhatsApp fallback
      const waUrl = `https://wa.me/916202692426?text=Hi! My name is ${encodeURIComponent(name)}. I am interested in ${encodeURIComponent(service)}. ${encodeURIComponent(message)}`;
      window.open(waUrl, '_blank');
      btn.textContent = 'Send Message';
      btn.disabled = false;
    }
  });
}

// Init on load
document.addEventListener('DOMContentLoaded', () => {
  initGalleryFilter();
  initContactForm();
});
