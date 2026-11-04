(function () {
    'use strict';

    var SESSION_KEY = 'nexus-ops-auth';
    var SESSION_DURATION = 8 * 60 * 60 * 1000;
    var REMEMBER_DURATION = 7 * 24 * 60 * 60 * 1000;
    var ACCOUNTS = [
        {
            id: 'central',
            aliases: ['central', 'admin', 'central@nexusops.com.br'],
            password: 'Nexus@2026',
            name: 'Equipe Central',
            role: 'admin',
            roleLabel: 'Administrador',
            home: 'index.html'
        },
        {
            id: 'cliente',
            aliases: ['cliente', 'supermercado', 'cliente@nexusops.com.br'],
            password: 'Cliente@2026',
            name: 'Supermercado XYZ',
            role: 'client',
            roleLabel: 'Cliente',
            home: 'supermercado-xyz.html'
        }
    ];

    function read(storage) {
        try {
            var value = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
            if (!value || !value.expiresAt || value.expiresAt <= Date.now()) {
                storage.removeItem(SESSION_KEY);
                return null;
            }
            return value;
        } catch (error) {
            storage.removeItem(SESSION_KEY);
            return null;
        }
    }

    function currentUser() {
        return read(sessionStorage) || read(localStorage);
    }

    function clearSession() {
        sessionStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(SESSION_KEY);
    }

    function findAccount(identifier) {
        var normalized = String(identifier || '').trim().toLowerCase();
        return ACCOUNTS.find(function (account) {
            return account.aliases.indexOf(normalized) !== -1;
        });
    }

    function login(identifier, password, remember) {
        var account = findAccount(identifier);
        if (!account || account.password !== String(password || '')) {
            return { ok: false, message: 'Usuário ou senha incorretos. Confira os dados e tente novamente.' };
        }

        clearSession();
        var session = {
            id: account.id,
            name: account.name,
            role: account.role,
            roleLabel: account.roleLabel,
            home: account.home,
            createdAt: Date.now(),
            expiresAt: Date.now() + (remember ? REMEMBER_DURATION : SESSION_DURATION)
        };
        (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(session));
        return { ok: true, user: session };
    }

    function currentFile() {
        var file = window.location.pathname.split('/').pop();
        return file || 'inicio.html';
    }

    function loginUrl() {
        var target = currentFile() + window.location.search + window.location.hash;
        return 'login.html?redirect=' + encodeURIComponent(target);
    }

    function requireAuth(allowedRoles) {
        var user = currentUser();
        if (!user) {
            document.documentElement.style.visibility = 'hidden';
            window.location.replace(loginUrl());
            return null;
        }
        if (Array.isArray(allowedRoles) && allowedRoles.length && allowedRoles.indexOf(user.role) === -1) {
            document.documentElement.style.visibility = 'hidden';
            window.location.replace(user.home);
            return null;
        }
        document.documentElement.classList.add('auth-ready');
        return user;
    }

    function isSafeRedirect(target, user) {
        if (!target || /^(?:[a-z]+:)?\/\//i.test(target) || target.indexOf('..') !== -1) return false;
        var file = target.split(/[?#]/)[0];
        var access = {
            'index.html': ['admin'],
            'central-gelo.html': ['admin'],
            'aparelhos.html': ['admin'],
            'supermercado-xyz.html': ['admin', 'client']
        };
        return access[file] && access[file].indexOf(user.role) !== -1;
    }

    function destinationFor(user, requestedTarget) {
        return isSafeRedirect(requestedTarget, user) ? requestedTarget : user.home;
    }

    function ensureExitOverlay() {
        var overlay = document.querySelector('.exit-curtain');
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.className = 'exit-curtain';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = '<div class="exit-glow"></div><div class="exit-message"><div class="exit-loader"></div><strong>Encerrando sistema</strong><span>Até a próxima operação</span></div>';
        document.body.insertBefore(overlay, document.body.firstChild);
        return overlay;
    }

    function logout(target, trigger) {
        if (document.body && document.body.classList.contains('system-closing')) return;
        clearSession();
        if (!document.body) {
            window.location.replace(target || 'login.html');
            return;
        }
        ensureExitOverlay();
        document.body.classList.add('system-closing');
        document.body.style.cursor = 'wait';
        if (trigger) trigger.disabled = true;
        var transitionDelay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 820;
        window.setTimeout(function () { window.location.replace(target || 'login.html'); }, transitionDelay);
    }

    function initials(name) {
        return String(name || 'Usuário').split(/\s+/).slice(0, 2).map(function (part) {
            return part.charAt(0);
        }).join('').toUpperCase();
    }

    function hydrateUserInterface() {
        var user = currentUser();
        if (!user) return;

        document.querySelectorAll('[data-auth-name]').forEach(function (element) {
            element.textContent = user.name;
        });
        document.querySelectorAll('[data-auth-role]').forEach(function (element) {
            element.textContent = user.roleLabel;
        });
        document.querySelectorAll('[data-auth-avatar]').forEach(function (element) {
            element.textContent = initials(user.name);
            element.title = user.name + ' · ' + user.roleLabel;
        });
        document.querySelectorAll('[data-admin-only]').forEach(function (element) {
            element.hidden = user.role !== 'admin';
        });
        var logoutButtons = document.querySelectorAll('[data-logout]');
        if (logoutButtons.length) ensureExitOverlay();
        logoutButtons.forEach(function (button) {
            button.addEventListener('click', function (event) {
                event.preventDefault();
                logout('login.html', button);
            });
        });
    }

    window.NexusAuth = {
        accounts: ACCOUNTS.map(function (account) {
            return { id: account.id, name: account.name, role: account.role, roleLabel: account.roleLabel, home: account.home };
        }),
        clearSession: clearSession,
        currentUser: currentUser,
        destinationFor: destinationFor,
        login: login,
        logout: logout,
        requireAuth: requireAuth
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hydrateUserInterface);
    } else {
        hydrateUserInterface();
    }
})();
