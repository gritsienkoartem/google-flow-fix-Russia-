// ==UserScript==
// @name         Google Flow & Labs Country Unlocker
// @namespace    http://tampermonkey.net/
// @version      6.2
// @description  Обходит проверку страны на стороне клиента для Google Flow и Google Labs
// @match        https://flow.google.com/*
// @match        https://labs.google/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const TAG = '[Flow Unlocker v6.2]';
  const BLOCKED = ['unsupported-country', 'unavailable'];
  const isBlocked = (u) => u && BLOCKED.some(b => String(u).includes(b));

  console.log(TAG, '?? Инициализировано на:', win.location.href);

  // 1. Редирект с заглушки (с защитой от цикла)
  if (isBlocked(win.location.pathname)) {
    try {
      if (!sessionStorage.getItem('__flow_unlock_redirected')) {
        sessionStorage.setItem('__flow_unlock_redirected', '1');
        win.location.replace('/');
        return;
      }
    } catch (e) {}
  } else {
    try { sessionStorage.removeItem('__flow_unlock_redirected'); } catch (e) {}
  }

  // 2. Блокировка перехода SPA-роутера на заглушку
  for (const method of ['pushState', 'replaceState']) {
    const orig = win.history[method];
    win.history[method] = function (state, title, url) {
      if (isBlocked(url)) {
        console.warn(TAG, `?? Заблокирован ${method}:`, url);
        return;
      }
      return orig.apply(this, arguments);
    };
  }

  // 3. WIZ_global_data
  try {
    const patchWiz = (o) => {
      if (o && typeof o === 'object') {
        o.awbSEf = true;
        if (!o.KLD0Rc) o.KLD0Rc = 'global';
      }
      return o;
    };
    const handler = {
      set(target, prop, value) {
        target[prop] = value;
        patchWiz(target);
        return true;
      }
    };
    let _wiz = new Proxy(patchWiz(win.WIZ_global_data || {}), handler);
    Object.defineProperty(win, 'WIZ_global_data', {
      get: () => _wiz,
      set: (v) => {
        if (v && typeof v === 'object') _wiz = new Proxy(patchWiz(v), handler);
      },
      configurable: true,
      enumerable: true
    });
  } catch (e) {
    console.warn(TAG, 'WIZ patch failed', e);
  }

  // 4. Подмена данных ответов
  const TARGET_RPCS = ['KV2T2d', 'rThb8d', 'cO7JOb', 'md9xJf'];
  const origParse = win.JSON.parse;
  const origStringify = win.JSON.stringify;

  function patchDeepJson(data, depth = 0) {
    if (!data || typeof data !== 'object' || depth > 50) return data;
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) patchDeepJson(data[i], depth + 1);
      return data;
    }
    for (const k of Object.keys(data)) {
      if (k === 'availabilityState') data[k] = 'AVAILABLE';
      else if (k === 'isCountrySupported' || k === 'is_country_supported') data[k] = true;
      else if (k === 'isAgeSupported' || k === 'is_age_supported') data[k] = true;
      else if (data[k] && typeof data[k] === 'object') patchDeepJson(data[k], depth + 1);
    }
    return data;
  }

  function patchBatchExecute(data) {
    if (!Array.isArray(data)) return;
    for (const item of data) {
      if (!Array.isArray(item) || item[0] !== 'wrb.fr' || typeof item[2] !== 'string') continue;
      const rpcid = item[1];
      try {
        const inner = origParse.call(win.JSON, item[2]);
        if (!Array.isArray(inner)) continue;
        if (rpcid === 'cPZSdc') {
          while (inner.length < 35) inner.push(null);
          inner[30] = 1; // is_country_supported
          inner[31] = 1; // is_age_supported
          inner[33] = 1;
          console.log(TAG, '?? Исправлено cPZSdc');
        } else if (TARGET_RPCS.includes(rpcid)) {
          if (inner.length === 0) inner.push(1); else inner[0] = 1;
          console.log(TAG, `?? Исправлено ${rpcid}`);
        } else {
          continue;
        }
        item[2] = origStringify.call(win.JSON, inner);
      } catch (e) {}
    }
  }

  win.JSON.parse = function (text, reviver) {
    const data = origParse.apply(this, arguments);
    if (!data || typeof data !== 'object') return data;
    patchBatchExecute(data);
    return patchDeepJson(data);
  };

  // response.json() не использует JSON.parse страницы — патчим отдельно
  try {
    const origJson = win.Response.prototype.json;
    win.Response.prototype.json = function () {
      return origJson.apply(this, arguments).then((d) => {
        patchBatchExecute(d);
        return patchDeepJson(d);
      });
    };
  } catch (e) {}
})();