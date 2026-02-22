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
    function activateTab(tab) {
        const isSignIn = tab === 'signin';

        tabSignIn.classList.toggle('active', isSignIn);
        tabRegister.classList.toggle('active', !isSignIn);
        tabSignIn.setAttribute('aria-selected', isSignIn);
        tabRegister.setAttribute('aria-selected', !isSignIn);

        signinForm.style.display = isSignIn ? 'flex' : 'none';
        registerForm.style.display = isSignIn ? 'none' : 'flex';

        // Clear errors when switching
        signinError.textContent = '';
        registerError.textContent = '';
    }

    tabSignIn.addEventListener('click', () => activateTab('signin'));
    tabRegister.addEventListener('click', () => activateTab('register'));

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
