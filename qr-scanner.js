/*
 * NEXUS OPS - controlador de leitura de QR Code via câmera.
 * Encapsula a biblioteca html5-qrcode e expõe uma API simples para as páginas.
 */
(function () {
    'use strict';

    var ASSET_CODE_PATTERN = /\b([A-Z]{1,12}-\d{2,6})\b/;
    // Etiquetas fornecidas para cada freezer. A leitura não depende de redirecionamento externo.
    var QR_CODE_ALIASES = {
        'https://www.canvaqr.com/RGWxElei8e': 'FREEZER-001',
        'https://www.canvaqr.com/RGWxEcRmzC': 'FREEZER-002',
        'https://www.canvaqr.com/RGWxDtKWVm': 'FREEZER-003'
    };
    var MAX_CODE_LENGTH = 40;
    var SAME_CODE_COOLDOWN_MS = 2500;
    var SCANNER_FPS = 12;
    var MIN_SCAN_BOX = 180;
    var SCAN_BOX_RATIO = 0.74;

    function isLibraryReady() {
        return typeof window.Html5Qrcode === 'function';
    }

    function isSecureEnough() {
        if (window.isSecureContext) return true;
        var host = window.location.hostname;
        return host === 'localhost' || host === '127.0.0.1';
    }

    function extractAssetCode(rawText) {
        var text = String(rawText == null ? '' : rawText).trim();
        if (!text) return '';
        try {
            var url = new URL(text);
            var alias = QR_CODE_ALIASES[url.origin + url.pathname.replace(/\/+$/, '')];
            if (alias) return alias;
        } catch (error) { /* Códigos simples não são URLs. */ }
        var upper = text.toUpperCase();
        var match = upper.match(ASSET_CODE_PATTERN);
        if (match) return match[1];
        var segments = upper.split(/[/?#&=:;\s]+/).filter(function (part) { return part.length > 0; });
        var candidate = segments.length ? segments[segments.length - 1] : upper;
        return candidate.slice(0, MAX_CODE_LENGTH);
    }

    function describeCameraError(error) {
        var name = error && error.name ? String(error.name) : '';
        var detail = error && error.message ? String(error.message) : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError' || /permission|denied/i.test(detail)) {
            return 'Permissão de câmera negada. Libere o acesso no ícone de câmera da barra de endereços e tente novamente.';
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || /not found|no camera/i.test(detail)) {
            return 'Nenhuma câmera encontrada neste dispositivo. Conecte uma câmera e tente novamente.';
        }
        if (name === 'NotReadableError' || name === 'TrackStartError' || /in use|readable/i.test(detail)) {
            return 'A câmera está em uso por outro aplicativo. Feche-o e tente novamente.';
        }
        if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
            return 'A câmera traseira não respondeu. Verifique se ela está disponível e tente novamente.';
        }
        if (/secure|https|localhost/i.test(detail)) {
            return 'A câmera só funciona em https ou localhost. Abra o sistema em um endereço seguro.';
        }
        return 'Não foi possível iniciar a câmera. Verifique as permissões do navegador e tente novamente.';
    }

    function isConstraintFailure(error) {
        var name = error && error.name ? String(error.name) : '';
        return name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError' || name === 'NotFoundError' || name === 'DevicesNotFoundError';
    }

    function scanConfig() {
        return {
            fps: SCANNER_FPS,
            aspectRatio: 1,
            qrbox: function (viewWidth, viewHeight) {
                var edge = Math.floor(Math.min(viewWidth, viewHeight) * SCAN_BOX_RATIO);
                var size = Math.max(MIN_SCAN_BOX, edge);
                return {
                    width: Math.min(size, Math.max(MIN_SCAN_BOX, viewWidth)),
                    height: Math.min(size, Math.max(MIN_SCAN_BOX, viewHeight))
                };
            }
        };
    }

    function createScanner(options) {
        var settings = options || {};
        var regionId = settings.regionId;
        var scanner = null;
        var state = 'idle';
        var stopRequested = false;
        var lastCode = '';
        var lastCodeAt = 0;

        function notifyStatus(message, tone) {
            if (typeof settings.onStatus === 'function') settings.onStatus(message, tone || 'info');
        }

        function notifyError(message, error) {
            if (typeof settings.onError === 'function') settings.onError(message, error || null);
        }

        function notifyDetected(code, rawText) {
            if (typeof settings.onDetected === 'function') settings.onDetected(code, rawText);
        }

        function buildInstance() {
            scanner = new window.Html5Qrcode(regionId, { verbose: false, useBarCodeDetectorIfSupported: true });
            return scanner;
        }

        function handleScanSuccess(decodedText) {
            var code = extractAssetCode(decodedText);
            var now = Date.now();
            if (code && code === lastCode && now - lastCodeAt < SAME_CODE_COOLDOWN_MS) return;
            lastCode = code;
            lastCodeAt = now;
            pauseScan();
            notifyDetected(code, decodedText);
        }

        function handleScanFailure() {
            /* Quadros sem QR Code são o caso normal: nada a fazer. */
        }

        function startCamera() {
            var instance = scanner || buildInstance();
            return instance.start({ facingMode: 'environment' }, scanConfig(), handleScanSuccess, handleScanFailure)
                .catch(function (error) {
                    if (!isConstraintFailure(error)) throw error;
                    instance = buildInstance();
                    return instance.start({ facingMode: 'user' }, scanConfig(), handleScanSuccess, handleScanFailure);
                });
        }

        function pauseScan() {
            if (!scanner || state !== 'scanning') return;
            try {
                scanner.pause(true);
                state = 'paused';
            } catch (error) {
                console.warn('[NEXUS OPS] Não foi possível pausar o leitor:', error);
            }
        }

        function start() {
            if (!isLibraryReady()) {
                notifyError('Leitor de QR Code não carregado. Verifique a conexão e recarregue a página.');
                return Promise.resolve();
            }
            if (!isSecureEnough()) {
                notifyError('A câmera precisa de conexão segura (https) ou localhost para funcionar neste navegador.');
                return Promise.resolve();
            }
            if (state === 'starting' || state === 'scanning') return Promise.resolve();
            if (!document.getElementById(regionId)) {
                notifyError('Área do leitor não encontrada na página. Recarregue e tente novamente.');
                return Promise.resolve();
            }

            state = 'starting';
            stopRequested = false;
            lastCode = '';
            lastCodeAt = 0;
            notifyStatus('Solicitando acesso à câmera...', 'loading');
            return startCamera()
                .then(function () {
                    if (stopRequested) {
                        stopRequested = false;
                        state = 'idle';
                        return stop();
                    }
                    state = 'scanning';
                    notifyStatus('Aponte a câmera para o QR Code do ativo.', 'live');
                })
                .catch(function (error) {
                    state = 'idle';
                    console.warn('[NEXUS OPS] Falha ao iniciar a câmera:', error && (error.name || error));
                    notifyError(describeCameraError(error), error);
                });
        }

        function stop() {
            stopRequested = state === 'starting';
            if (!scanner) {
                state = 'idle';
                return Promise.resolve();
            }
            var target = scanner;
            var previousState = state;
            state = 'idle';
            var stopPromise;
            try {
                stopPromise = target.stop();
            } catch (error) {
                stopPromise = Promise.resolve();
            }
            return Promise.resolve(stopPromise)
                .catch(function () { return undefined; })
                .then(function () {
                    if (previousState === 'idle') return undefined;
                    try { target.clear(); } catch (error) { /* região já vazia */ }
                    return undefined;
                });
        }

        function resume() {
            if (state === 'paused') {
                try {
                    scanner.resume();
                    state = 'scanning';
                    notifyStatus('Aponte a câmera para o QR Code do ativo.', 'live');
                    return Promise.resolve();
                } catch (error) {
                    state = 'idle';
                }
            }
            return start();
        }

        return {
            start: start,
            stop: stop,
            pause: pauseScan,
            resume: resume,
            isActive: function () { return state === 'scanning' || state === 'paused'; }
        };
    }

    window.NexusQrScanner = {
        create: createScanner,
        describeCameraError: describeCameraError,
        extractAssetCode: extractAssetCode,
        isLibraryReady: isLibraryReady,
        isSecureEnough: isSecureEnough
    };
})();
