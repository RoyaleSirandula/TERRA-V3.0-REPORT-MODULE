/* ============================================================
   TERRA – login.js
   Handles the Sign In / Register tab toggle and form submission.
   On success, saves the session and redirects to the main app.

   Self-contained — no dependency on the main app modules.
   ============================================================ */

(function () {
    'use strict';

    /* ── Config ──────────────────────────────────────────────── */
    const BASE = '';   // Same origin — no need for absolute URL

    /* ── Redirect if already logged in ──────────────────────── */
    const existingToken = sessionStorage.getItem('terra_token');
    if (existingToken) {
        window.location.replace('/');
    }

    /* ── DOM references ──────────────────────────────────────── */
    const tabSignIn = document.getElementById('tab-signin');
    const tabRegister = document.getElementById('tab-register');
    const signinForm = document.getElementById('signin-form');
    const registerForm = document.getElementById('register-form');
    const signinError = document.getElementById('signin-error');
    const registerError = document.getElementById('register-error');

    /* ── Tab switcher ────────────────────────────────────────── */
    let _switching = false;

    function activateTab(tab) {
        if (_switching) return;

        const isSignIn = tab === 'signin';
        const outgoing = isSignIn ? registerForm : signinForm;
        const incoming = isSignIn ? signinForm : registerForm;

        if (incoming.classList.contains('is-active')) return;

        _switching = true;

        // Update tab bar
        tabSignIn.classList.toggle('active', isSignIn);
        tabRegister.classList.toggle('active', !isSignIn);
        tabSignIn.setAttribute('aria-selected', String(isSignIn));
        tabRegister.setAttribute('aria-selected', String(!isSignIn));

        // Clear errors
        signinError.textContent = '';
        registerError.textContent = '';

        // Prime incoming off-screen right (absolute, invisible)
        incoming.classList.remove('is-active');
        incoming.classList.add('is-entering');

        // Force reflow so initial state registers before transition starts
        incoming.getBoundingClientRect();

        // Swap: outgoing exits left (stays absolute), incoming enters as active (goes into flow)
        // The card immediately resizes to incoming's natural height — no clipping
        outgoing.classList.remove('is-active');
        outgoing.classList.add('is-leaving');

        incoming.classList.remove('is-entering');
        incoming.classList.add('is-active');

        // Clean up leaving form after animation completes
        setTimeout(() => {
            outgoing.classList.remove('is-leaving');
            _switching = false;
        }, 300);
    }

    tabSignIn.addEventListener('click', () => activateTab('signin'));
    tabRegister.addEventListener('click', () => activateTab('register'));

    /* ── Custom Role Dropdown ────────────────────────────────── */
    const roleDropdown = document.getElementById('role-dropdown');
    const roleInput    = document.getElementById('reg-role');
    const roleDisplay  = document.getElementById('role-display');
    const roleOptions  = roleDropdown.querySelectorAll('.ld__option');

    function closeDropdown() {
        roleDropdown.setAttribute('aria-expanded', 'false');
    }

    function openDropdown() {
        roleDropdown.setAttribute('aria-expanded', 'true');
    }

    function selectOption(el) {
        roleOptions.forEach(o => {
            o.classList.remove('ld__option--selected');
            o.setAttribute('aria-selected', 'false');
        });
        el.classList.add('ld__option--selected');
        el.setAttribute('aria-selected', 'true');
        roleInput.value   = el.dataset.value;
        roleDisplay.textContent = el.querySelector('.ld__option-label').textContent;
        closeDropdown();
        roleDropdown.focus();
    }

    // Toggle open/close on trigger click
    roleDropdown.addEventListener('click', (e) => {
        const isOpen = roleDropdown.getAttribute('aria-expanded') === 'true';
        isOpen ? closeDropdown() : openDropdown();

        const opt = e.target.closest('.ld__option');
        if (opt) selectOption(opt);
    });

    // Keyboard navigation
    roleDropdown.addEventListener('keydown', (e) => {
        const isOpen = roleDropdown.getAttribute('aria-expanded') === 'true';
        const opts   = [...roleOptions];
        const cur    = opts.findIndex(o => o.classList.contains('ld__option--selected'));

        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            isOpen ? closeDropdown() : openDropdown();
        } else if (e.key === 'Escape') {
            closeDropdown();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!isOpen) { openDropdown(); return; }
            selectOption(opts[Math.min(cur + 1, opts.length - 1)]);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectOption(opts[Math.max(cur - 1, 0)]);
        }
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!roleDropdown.contains(e.target)) closeDropdown();
    });

    /* ── Helper: set loading state on a button ───────────────── */
    function setLoading(btn, isLoading) {
        btn.classList.toggle('loading', isLoading);
        btn.disabled = isLoading;
    }

    /* ── Helper: POST to the API (no auth needed here) ────────── */
    async function post(endpoint, body) {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    }

    /* ── Helper: save session and redirect ───────────────────── */
    function onAuthSuccess(data) {
        Auth.setSession(data.token, data.user);
        window.location.replace('/');
    }

    /* ── Sign In form submit ─────────────────────────────────── */
    signinForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        signinError.textContent = '';

        const btn = document.getElementById('signin-btn');
        const email = document.getElementById('signin-email').value.trim();
        const password = document.getElementById('signin-password').value;

        if (!email || !password) {
            signinError.textContent = 'Please fill in all fields.';
            return;
        }

        setLoading(btn, true);
        try {
            const data = await post('/api/auth/login', { email, password });
            onAuthSuccess(data);
        } catch (err) {
            signinError.textContent = err.message || 'Sign in failed. Please try again.';
        } finally {
            setLoading(btn, false);
        }
    });

    /* ── Register form submit ────────────────────────────────── */
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        registerError.textContent = '';

        const btn = document.getElementById('register-btn');
        const username = document.getElementById('reg-username').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const role = document.getElementById('reg-role').value;

        if (!username || !email || !password) {
            registerError.textContent = 'Please fill in all required fields.';
            return;
        }

        if (password.length < 8) {
            registerError.textContent = 'Password must be at least 8 characters.';
            return;
        }

        setLoading(btn, true);
        try {
            const data = await post('/api/auth/register', { username, email, password, role });
            onAuthSuccess(data);
        } catch (err) {
            registerError.textContent = err.message || 'Registration failed. Please try again.';
        } finally {
            setLoading(btn, false);
        }
    });

})();
