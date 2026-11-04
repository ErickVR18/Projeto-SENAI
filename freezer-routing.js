(function () {
    'use strict';
    // Executado antes da autenticação: o login preserva o destino do QR Code.
    var code = new URLSearchParams(window.location.search).get('freezer');
    if (!code) return;
    code = code.trim().toUpperCase();
    if (!/^FREEZER-\d{3,6}$/.test(code)) return;
    window.location.replace('aparelhos.html?freezer=' + encodeURIComponent(code));
})();