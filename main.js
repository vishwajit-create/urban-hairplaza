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

  // ── AI HAIRSTYLE TRY-ON FLOATING WIDGET & MODAL ──────────────────────────
  function initTryOnWidget() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('/admin') || path.includes('/owner')) return;

    if (!document.getElementById('uhp-tryon-widget')) {
      const widget = document.createElement('div');
      widget.id = 'uhp-tryon-widget';
      widget.innerHTML = '<button id="uhp-open-btn" style="position: fixed; bottom: 24px; right: 24px; background: linear-gradient(135deg, #d4af37, #aa820a); color: #111; border: none; padding: 13px 22px; border-radius: 30px; font-weight: 700; font-size: 14px; cursor: pointer; box-shadow: 0 8px 24px rgba(0,0,0,0.25); z-index: 999998; display: flex; align-items: center; gap: 8px; transition: transform 0.2s ease, box-shadow 0.2s ease;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg><span>AI Hairstyle Try-On</span></button>' +
        '<div id="uhp-modal-backdrop" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 999999; align-items: center; justify-content: center;">' +
          '<div style="position: relative; width: 94%; max-width: 1200px; height: 90vh; background: #0f1015; border-radius: 16px; overflow: hidden; border: 1px solid rgba(212, 175, 55, 0.3); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7);">' +
            '<button id="uhp-close-btn" aria-label="Close AI Try-On" style="position: absolute; top: 14px; right: 18px; background: rgba(255,255,255,0.15); color: #fff; border: none; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; font-size: 20px; line-height: 1; z-index: 10; display: flex; align-items: center; justify-content: center; transition: background 0.2s ease;">&times;</button>' +
            '<div id="uhp-iframe-loader" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #0f1015; color: #fff; z-index: 1;">' +
              '<div style="width: 40px; height: 40px; border: 3px solid rgba(212,175,55,0.2); border-top-color: #d4af37; border-radius: 50%; animation: uhp-spin 0.8s linear infinite;"></div>' +
              '<p style="margin-top: 14px; font-size: 14px; color: #d1d5db; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">Connecting to AI Hairstyle Engine...</p>' +
            '</div>' +
            '<iframe id="uhp-tryon-iframe" data-src="https://face-recognition-system-hitg.onrender.com" src="" style="width: 100%; height: 100%; border: none; position: relative; z-index: 2;" allow="camera; microphone"></iframe>' +
          '</div>' +
        '</div>';
      document.body.appendChild(widget);
    }

    const openBtn = document.getElementById('uhp-open-btn');
    const closeBtn = document.getElementById('uhp-close-btn');
    const modal = document.getElementById('uhp-modal-backdrop');
    const iframe = document.getElementById('uhp-tryon-iframe');
    const loader = document.getElementById('uhp-iframe-loader');

    if (!openBtn || !closeBtn || !modal || !iframe) return;

    openBtn.addEventListener('mouseenter', () => {
      openBtn.style.transform = 'translateY(-2px)';
      openBtn.style.boxShadow = '0 12px 28px rgba(0,0,0,0.35)';
    });
    openBtn.addEventListener('mouseleave', () => {
      openBtn.style.transform = 'none';
      openBtn.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)';
    });

    if (loader) {
      iframe.addEventListener('load', () => {
        if (iframe.src && iframe.src !== 'about:blank' && iframe.src !== window.location.href) {
          loader.style.display = 'none';
        }
      });
    }

    function openModal() {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      if (!iframe.src || iframe.src === 'about:blank' || iframe.src === window.location.href) {
        if (loader) loader.style.display = 'flex';
        iframe.src = iframe.getAttribute('data-src') || 'https://face-recognition-system-hitg.onrender.com';
      }
    }

    function closeModal() {
      modal.style.display = 'none';
      document.body.style.overflow = '';
      iframe.src = 'about:blank';
    }

    openBtn.onclick = openModal;
    closeBtn.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        closeModal();
      }
    });
  }

  initTryOnWidget();

});
