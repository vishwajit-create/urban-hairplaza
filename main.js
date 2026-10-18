/**
 * Urban Hairplaza — Client Utilities
 * Clean, lightweight, reliable JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
  // ── MOBILE MENU TOGGLE ───────────────────────────────────────────────────
  const hamburger = document.getElementById('hamburger');
  const mobileDrawer = document.getElementById('mobile-drawer');

  if (hamburger && mobileDrawer) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileDrawer.classList.toggle('open');
      hamburger.classList.toggle('open');
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    mobileDrawer.querySelectorAll('.nav-link, .btn').forEach(link => {
      link.addEventListener('click', () => {
        mobileDrawer.classList.remove('open');
        hamburger.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  // ── ACTIVE NAVIGATION LINK ───────────────────────────────────────────────
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath || (currentPath === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });

  // ── LIGHTBOX GALLERY ─────────────────────────────────────────────────────
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxClose = document.getElementById('lightbox-close');

  if (lightbox && lightboxImg) {
    document.querySelectorAll('.gallery-item img').forEach(img => {
      img.addEventListener('click', () => {
        lightboxImg.src = img.src;
        lightbox.classList.add('open');
        document.body.style.overflow = 'hidden';
      });
    });

    function closeLightbox() {
      lightbox.classList.remove('open');
      document.body.style.overflow = '';
    }

    if (lightboxClose) {
      lightboxClose.addEventListener('click', closeLightbox);
    }

    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightbox.classList.contains('open')) {
        closeLightbox();
      }
    });
  }

  // ── COOKIE CONSENT BANNER ────────────────────────────────────────────────
  const consent = localStorage.getItem('uhp_cookie_consent');
  if (!consent) {
    const banner = document.createElement('div');
    banner.id = 'uhp-cookie-banner';
    banner.innerHTML = `
      <div style="position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); width: calc(100% - 32px); max-width: 860px; background: #111827; color: #F9FAFB; border: 1px solid rgba(212, 175, 55, 0.4); border-radius: 12px; padding: 18px 22px; box-shadow: 0 12px 35px rgba(0,0,0,0.45); z-index: 999999; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="display: flex; align-items: flex-start; gap: 12px; max-width: 540px;">
          <div style="font-size: 1.5rem; line-height: 1;">🍪</div>
          <div style="font-size: 0.88rem; line-height: 1.5; color: #E5E7EB;">
            <strong>Your Privacy & Cookies:</strong> We use essential cookies to keep you signed in and secure your appointment bookings. We strictly never sell or track your data. By using our site, you agree to our <a href="privacy.html" style="color: #D4AF37; text-decoration: underline; font-weight: 600;">Privacy & Cookies Policy</a>.
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <button id="uhp-cookie-essential" style="background: transparent; border: 1px solid #4B5563; color: #D1D5DB; font-size: 0.82rem; font-weight: 600; padding: 8px 14px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease;">
            Essential Only
          </button>
          <button id="uhp-cookie-accept" style="background: #D4AF37; border: 1px solid #D4AF37; color: #111827; font-size: 0.82rem; font-weight: 700; padding: 8px 18px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease;">
            Accept All
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    const closeBanner = (choice) => {
      localStorage.setItem('uhp_cookie_consent', choice);
      banner.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      banner.style.opacity = '0';
      banner.style.pointerEvents = 'none';
      setTimeout(() => banner.remove(), 350);
    };

    document.getElementById('uhp-cookie-accept')?.addEventListener('click', () => closeBanner('accepted'));
    document.getElementById('uhp-cookie-essential')?.addEventListener('click', () => closeBanner('essential'));
  }
});
