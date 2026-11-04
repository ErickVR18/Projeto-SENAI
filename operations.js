(function () {
    'use strict';

    var STATUS_FLOW = ['production', 'separating', 'route', 'delivered'];
    var CLIENT_NAME = 'Supermercado XYZ';
    var CENTRAL_CAPACITY = 4000;

    function finiteNumber(value, fallback) {
        var number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function validStatus(status) {
        return STATUS_FLOW.indexOf(status) !== -1 ? status : 'production';
    }

    function createOrderUid(prefix) {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
        return String(prefix || 'order') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }

    function normalizeOrders(orders) {
        if (!Array.isArray(orders)) return [];
        var now = Date.now();
        var byKey = {};
        orders.forEach(function (order, index) {
            if (!order || !Number.isFinite(Number(order.id))) return;
            var id = Number(order.id);
            var uid = order.uid ? String(order.uid) : '';
            var identity = uid ? 'uid:' + uid : 'id:' + id;
            var status = validStatus(order.status);
            var createdAt = finiteNumber(order.createdAt, now - index * 60000);
            var candidate = {
                id: id,
                uid: uid,
                quantity: Math.max(1, finiteNumber(order.quantity, 50)),
                status: status,
                client: order.client || CLIENT_NAME,
                createdAt: createdAt,
                statusChangedAt: finiteNumber(order.statusChangedAt, createdAt)
            };
            if (Number.isFinite(Number(order.deliveredAt))) candidate.deliveredAt = Number(order.deliveredAt);
            var current = byKey[identity];
            if (!current || STATUS_FLOW.indexOf(candidate.status) > STATUS_FLOW.indexOf(current.status) || (candidate.status === current.status && candidate.statusChangedAt >= current.statusChangedAt)) {
                byKey[identity] = candidate;
            }
        });
        var normalized = Object.keys(byKey).map(function (key) { return byKey[key]; });
        var highestId = normalized.reduce(function (highest, order) { return Math.max(highest, order.id); }, 1025);
        var usedIds = {};
        normalized.sort(function (a, b) {
            return a.createdAt - b.createdAt || a.id - b.id || String(a.uid).localeCompare(String(b.uid));
        }).forEach(function (order) {
            if (usedIds[order.id]) {
                do { highestId += 1; } while (usedIds[highestId]);
                order.id = highestId;
            }
            usedIds[order.id] = true;
        });
        return normalized.sort(function (a, b) { return b.id - a.id; });
    }

    function mergeOrders(currentOrders, incomingOrders) {
        return normalizeOrders([].concat(currentOrders || [], incomingOrders || []));
    }

    function nextOrderId(orders, savedNextId) {
        var highestId = normalizeOrders(orders).reduce(function (highest, order) { return Math.max(highest, order.id); }, 1025);
        var candidate = finiteNumber(savedNextId, 0);
        return Math.max(highestId + 1, candidate, 1026);
    }

    function ordersForClient(orders, clientName) {
        var name = clientName || CLIENT_NAME;
        return normalizeOrders(orders).filter(function (order) { return order.client === name; });
    }

    function countOrders(orders, clientName) {
        var normalized = clientName ? ordersForClient(orders, clientName) : normalizeOrders(orders);
        return {
            total: normalized.length,
            open: normalized.filter(function (order) { return order.status !== 'delivered'; }).length,
            production: normalized.filter(function (order) { return order.status === 'production'; }).length,
            separating: normalized.filter(function (order) { return order.status === 'separating'; }).length,
            route: normalized.filter(function (order) { return order.status === 'route'; }).length,
            delivered: normalized.filter(function (order) { return order.status === 'delivered'; }).length
        };
    }

    function createDefaultState() {
        var now = Date.now();
        var orders = [
            { id: 1035, quantity: 80, status: 'route', client: CLIENT_NAME },
            { id: 1034, quantity: 70, status: 'route', client: 'Padaria Nova' },
            { id: 1033, quantity: 60, status: 'route', client: 'Mercado Central' },
            { id: 1032, quantity: 80, status: 'delivered', client: 'Bar do Zé' },
            { id: 1031, quantity: 50, status: 'production', client: CLIENT_NAME },
            { id: 1030, quantity: 120, status: 'route', client: 'Mercado Central' },
            { id: 1029, quantity: 30, status: 'delivered', client: 'Lanchonete do Bairro' }
        ].map(function (order, index) {
            var createdAt = now - (index + 1) * 60000;
            return Object.assign({}, order, { createdAt: createdAt, statusChangedAt: createdAt });
        });
        var counts = countOrders(orders);
        return {
            schemaVersion: 2,
            revision: 0,
            updatedAt: now,
            resetAt: 0,
            production: 12450,
            centralStockBags: 3440,
            clientStock: 2450,
            stockPercent: 86,
            revenueValue: 48200,
            revenue: 'R$ 48,2k',
            simulationStep: 0,
            simulationPaused: false,
            nextOrderId: 1036,
            orderNumber: 1036,
            lastEvent: '',
            lastEventOrder: '',
            openOrders: counts.open,
            totalOrders: counts.total,
            deliveries: counts.route,
            recentOrders: normalizeOrders(orders)
        };
    }

    function prepareState(rawState) {
        var raw = rawState && typeof rawState === 'object' ? rawState : {};
        var defaults = createDefaultState();
        var hasOrderList = Array.isArray(raw.recentOrders);
        var orders = normalizeOrders(hasOrderList ? raw.recentOrders : defaults.recentOrders);
        var counts = countOrders(orders);
        var centralStockBags = Math.max(0, finiteNumber(raw.centralStockBags,
            Number.isFinite(Number(raw.stockPercent)) ? Math.round(Number(raw.stockPercent) * CENTRAL_CAPACITY / 100) : defaults.centralStockBags));
        var stockPercent = Math.round(Math.min(100, centralStockBags / CENTRAL_CAPACITY * 100));
        var nextId = nextOrderId(orders, raw.nextOrderId || raw.orderNumber || defaults.nextOrderId);
        return Object.assign({}, defaults, raw, {
            schemaVersion: 2,
            recentOrders: orders,
            openOrders: counts.open,
            totalOrders: counts.total,
            deliveries: counts.route,
            centralStockBags: centralStockBags,
            clientStock: Math.max(0, finiteNumber(raw.clientStock, defaults.clientStock)),
            stockPercent: stockPercent,
            production: Math.max(0, finiteNumber(raw.production, defaults.production)),
            revenueValue: Math.max(0, finiteNumber(raw.revenueValue, defaults.revenueValue)),
            simulationStep: Math.max(0, finiteNumber(raw.simulationStep, 0)),
            nextOrderId: nextId,
            orderNumber: nextId,
            resetAt: Math.max(0, finiteNumber(raw.resetAt, 0))
        });
    }

    function oldestByStatus(orders, status) {
        return normalizeOrders(orders).filter(function (order) { return order.status === status; }).sort(function (a, b) {
            return a.statusChangedAt - b.statusChangedAt || a.id - b.id;
        })[0] || null;
    }

    function advanceOrder(orders, orderId, changedAt) {
        var normalized = normalizeOrders(orders);
        var identity = String(orderId);
        var numericId = Number(orderId);
        var order = normalized.find(function (item) { return (item.uid && item.uid === identity) || (!Number.isNaN(numericId) && item.id === numericId); });
        if (!order) return { orders: normalized, order: null, previousStatus: null };
        var currentIndex = STATUS_FLOW.indexOf(order.status);
        if (currentIndex < 0 || currentIndex === STATUS_FLOW.length - 1) return { orders: normalized, order: order, previousStatus: order.status };
        var previousStatus = order.status;
        order.status = STATUS_FLOW[currentIndex + 1];
        order.statusChangedAt = finiteNumber(changedAt, Date.now());
        if (order.status === 'delivered') order.deliveredAt = order.statusChangedAt;
        return { orders: normalizeOrders(normalized), order: order, previousStatus: previousStatus };
    }

    function createStateBus(key) {
        var listeners = [];
        var sourceId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        var lastSignature = '';
        var channel = null;
        try { if ('BroadcastChannel' in window) channel = new BroadcastChannel(key + '-channel'); } catch (error) { channel = null; }

        function read() {
            try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (error) { return {}; }
        }

        function signature(state) {
            return String(state && state.mutationId || '') + ':' + String(state && state.revision || 0) + ':' + String(state && state.updatedAt || 0) + ':' + String(state && state.resetAt || 0);
        }

        function receive(state, origin) {
            if (!state || origin === sourceId) return;
            var current = read();
            var incomingReset = finiteNumber(state.resetAt, 0);
            var currentReset = finiteNumber(current.resetAt, 0);
            var incomingRevision = finiteNumber(state.revision, 0);
            var currentRevision = finiteNumber(current.revision, 0);
            if (incomingReset < currentReset || (incomingReset === currentReset && incomingRevision < currentRevision)) return;
            var nextSignature = signature(state);
            if (nextSignature === lastSignature) return;
            lastSignature = nextSignature;
            listeners.slice().forEach(function (listener) { listener(state); });
        }

        function publish(state) {
            var stored = read();
            var updatedAt = Date.now();
            var payload = Object.assign({}, state, {
                schemaVersion: 2,
                revision: Math.max(finiteNumber(stored.revision, 0), finiteNumber(state.revision, 0)) + 1,
                updatedAt: updatedAt,
                mutationId: sourceId + ':' + updatedAt.toString(36) + ':' + Math.random().toString(36).slice(2)
            });
            lastSignature = signature(payload);
            localStorage.setItem(key, JSON.stringify(payload));
            if (channel) channel.postMessage({ sourceId: sourceId, state: payload });
            try { window.dispatchEvent(new CustomEvent(key + '-sync', { detail: { sourceId: sourceId, state: payload } })); } catch (error) { /* CustomEvent fallback is unnecessary for storage sync. */ }
            return payload;
        }

        window.addEventListener('storage', function (event) {
            if (event.key !== key || !event.newValue) return;
            try { receive(JSON.parse(event.newValue), 'storage'); } catch (error) { /* Ignore malformed external state. */ }
        });
        window.addEventListener(key + '-sync', function (event) {
            if (event && event.detail) receive(event.detail.state, event.detail.sourceId);
        });
        window.addEventListener('focus', function () { receive(read(), 'focus'); });
        document.addEventListener('visibilitychange', function () { if (!document.hidden) receive(read(), 'visibility'); });
        if (channel) channel.addEventListener('message', function (event) {
            if (event && event.data) receive(event.data.state, event.data.sourceId);
        });

        return {
            read: read,
            publish: publish,
            subscribe: function (listener) {
                listeners.push(listener);
                return function () { listeners = listeners.filter(function (item) { return item !== listener; }); };
            }
        };
    }

    window.NexusOperations = {
        CENTRAL_CAPACITY: CENTRAL_CAPACITY,
        CLIENT_NAME: CLIENT_NAME,
        STATUS_FLOW: STATUS_FLOW.slice(),
        advanceOrder: advanceOrder,
        countOrders: countOrders,
        createDefaultState: createDefaultState,
        createOrderUid: createOrderUid,
        createStateBus: createStateBus,
        mergeOrders: mergeOrders,
        nextOrderId: nextOrderId,
        normalizeOrders: normalizeOrders,
        oldestByStatus: oldestByStatus,
        ordersForClient: ordersForClient,
        prepareState: prepareState
    };
})();
